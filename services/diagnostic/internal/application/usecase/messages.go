package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math/rand/v2"
	"time"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/application/projection"
	"umccare/diagnostic/internal/domain"
)

func strictJSON(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return e
	}
	var x any
	if d.Decode(&x) != io.EOF {
		return domain.Fail("INVALID_MESSAGE", "Exactly one JSON object required")
	}
	return nil
}

type retryLeaseKey struct{}

func retryLease(ctx context.Context) string { s, _ := ctx.Value(retryLeaseKey{}).(string); return s }

type Receiver struct {
	s        *Service
	delivery ports.DeliveryStore
}

func NewReceiver(s *Service, d ports.DeliveryStore) *Receiver { return &Receiver{s, d} }
func (r *Receiver) Receive(ctx context.Context, in ports.Incoming) error {
	var m domain.Envelope
	if len(in.Body) > 1<<20 || strictJSON(in.Body, &m) != nil || !domain.ValidID(m.MessageID) || (in.MessageID != "" && domain.ID(in.MessageID) != domain.ID(m.MessageID)) || in.Attempt < 0 || in.Attempt > 3 {
		return r.delivery.Quarantine(ctx, in, "INVALID_MESSAGE")
	}
	in.MessageID = domain.ID(m.MessageID)
	if in.Attempt > 0 {
		if !domain.ValidID(in.LeaseID) {
			return r.delivery.Quarantine(ctx, in, "INVALID_MESSAGE")
		}
		ctx = context.WithValue(ctx, retryLeaseKey{}, domain.ID(in.LeaseID))
	}
	e := r.s.Handle(ctx, in.Exchange, in.RoutingKey, m)
	if e == nil {
		return nil
	}
	if domain.Code(e) != "SERVICE_UNAVAILABLE" {
		return r.delivery.Quarantine(ctx, in, domain.Code(e))
	}
	if in.Attempt == 3 {
		return r.delivery.Quarantine(ctx, in, "RETRY_EXHAUSTED")
	}
	return r.delivery.ScheduleRetry(ctx, in, in.Attempt+1, []time.Duration{5 * time.Second, 15 * time.Second, 60 * time.Second}[in.Attempt]+time.Duration(rand.IntN(1000))*time.Millisecond)
}

type Versioned struct {
	Version int             `json:"version"`
	Value   json.RawMessage `json:"value"`
}

func (s *Service) Handle(ctx context.Context, exchange, route string, m domain.Envelope) error {
	if m.SchemaVersion != 1 || !domain.ValidID(m.MessageID) || !domain.ValidID(m.AggregateID) || m.AggregateVersion < 1 || m.CorrelationID == "" || len(m.CorrelationID) > 128 || m.OccurredAt.IsZero() {
		return domain.Fail("INVALID_MESSAGE", "Invalid message envelope")
	}
	expected := map[string][3]string{"CreateLabOrder": {"clinical", "umc.commands.clinical.v1", "diagnostic.create-lab-order.v1"}, "ReserveSettlement": {"billing", "umc.commands.billing.v1", "diagnostic.reserve-settlement.v1"}, "ChargePrepared": {"billing", "umc.events.billing.v1", "billing.charge-prepared.v1"}, "BillingStatusChanged": {"billing", "umc.events.billing.v1", "billing.billing-status-changed.v1"}, "ChargePaid": {"billing", "umc.events.billing.v1", "billing.charge-paid.v1"}, "SettlementDecision": {"billing", "umc.events.billing.v1", "billing.settlement-decision.v1"}, "IdentityAccessChanged": {"identity", "umc.events.identity.v1", "identity.identity-access-changed.v1"}, "PatientAccessChanged": {"patient", "umc.events.patient.v1", "patient.patient-access-changed.v1"}, "CatalogChanged": {"catalog", "umc.events.catalog.v1", "catalog.changed.v1"}}
	v, ok := expected[m.MessageType]
	producer := m.Producer
	if producer == "Catalog" {
		producer = "catalog"
	}
	if !ok || producer != v[0] || exchange != v[1] || (route != v[2] && !(m.MessageType == "CatalogChanged" && route == "catalog.catalog-changed.v1")) {
		return domain.Fail("INVALID_MESSAGE", "Untrusted message source")
	}
	kind := "EVENT"
	if m.MessageType == "CreateLabOrder" || m.MessageType == "ReserveSettlement" {
		kind = "COMMAND"
	}
	if m.MessageKind != kind {
		return domain.Fail("INVALID_MESSAGE", "Invalid message kind")
	}
	gap := false
	err := s.store.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		h := domain.Hash(m)
		seen, e := t.SeenMessage(ctx, domain.ID(m.MessageID), h, retryLease(ctx))
		if e != nil || seen {
			return e
		}
		switch m.MessageType {
		case "CreateLabOrder":
			e = s.create(ctx, t, m)
		case "IdentityAccessChanged", "PatientAccessChanged", "CatalogChanged":
			e = s.project(ctx, t, m)
		default:
			e = s.billing(ctx, t, m)
		}
		if domain.Code(e) == "CATALOG_STREAM_GAP" {
			gap = true
			return nil
		}
		if e != nil {
			return e
		}
		if gap {
			return nil
		}
		return t.MarkMessage(ctx, domain.ID(m.MessageID), h)
	})
	if err != nil {
		return err
	}
	if gap {
		return domain.Fail("SERVICE_UNAVAILABLE", "Catalog stream gap")
	}
	return nil
}
func putVersion(ctx context.Context, t ports.Tx, kind, key string, version int, value any) error {
	return projection.Put(ctx, t, kind, key, version, value)
}
func (s *Service) project(ctx context.Context, t ports.Tx, m domain.Envelope) error {
	switch m.MessageType {
	case "IdentityAccessChanged":
		var p struct {
			UserID, Status, ActorType string
			TokenVersion              *int
			Version                   int
			Capabilities              []string
			PhoneVerified             *bool
		}
		if strictJSON(m.Payload, &p) != nil || !domain.ValidID(p.UserID) || domain.ID(p.UserID) != domain.ID(m.AggregateID) || p.Version != m.AggregateVersion || p.TokenVersion == nil || p.Capabilities == nil || p.PhoneVerified == nil || *p.TokenVersion < 0 {
			return domain.Fail("INVALID_MESSAGE", "Invalid identity projection")
		}
		return putVersion(ctx, t, "access", domain.ID(p.UserID), p.Version, domain.Access{UserID: domain.ID(p.UserID), ActorType: p.ActorType, Status: p.Status, TokenVersion: *p.TokenVersion, Capabilities: p.Capabilities})
	case "PatientAccessChanged":
		var p struct {
			PatientID, OwnerUserID string
			Active                 *bool
			PolicyVersion          int
		}
		if strictJSON(m.Payload, &p) != nil || !domain.ValidID(p.PatientID) || !domain.ValidID(p.OwnerUserID) || p.Active == nil || p.PolicyVersion != m.AggregateVersion || domain.ID(p.PatientID) != domain.ID(m.AggregateID) {
			return domain.Fail("INVALID_MESSAGE", "Invalid patient projection")
		}
		return putVersion(ctx, t, "patient", domain.ID(p.PatientID), p.PolicyVersion, map[string]any{"ownerUserId": domain.ID(p.OwnerUserID), "active": *p.Active})
	case "CatalogChanged":
		var p struct {
			EntityType, EntityID, Mode string
			EntityVersion              int
			FullSnapshot               json.RawMessage
			EffectiveAt                time.Time
			StreamSequence             int64
		}
		if strictJSON(m.Payload, &p) != nil || p.StreamSequence < 0 || (p.Mode != "CHECKPOINT" && p.StreamSequence < 1) || !domain.Has([]string{"UPSERT", "TOMBSTONE", "CHECKPOINT"}, p.Mode) {
			return domain.Fail("INVALID_MESSAGE", "Invalid catalog projection")
		}
		var prior struct {
			Sequence int64
			At       time.Time
		}
		e := load(ctx, t, "catalog", "checkpoint", &prior)
		if e != nil && domain.Code(e) != "NOT_FOUND" {
			return e
		}
		if p.Mode == "CHECKPOINT" {
			var snapshot struct {
				Sequence int64     `json:"sequence"`
				At       time.Time `json:"at"`
			}
			if strictJSON(p.FullSnapshot, &snapshot) != nil || snapshot.Sequence != p.StreamSequence || snapshot.At.IsZero() || domain.ID(m.AggregateID) != domain.ID(p.EntityID) {
				return domain.Fail("INVALID_MESSAGE", "Invalid checkpoint snapshot")
			}
			if p.EntityType != "STREAM" || !domain.ValidID(p.EntityID) || p.EntityVersion < 1 || p.EffectiveAt.IsZero() || m.AggregateVersion != p.EntityVersion {
				return domain.Fail("INVALID_MESSAGE", "Invalid catalog checkpoint")
			}
			if p.StreamSequence > prior.Sequence {
				var highest int64
				ge := load(ctx, t, "catalog", "highest_observed", &highest)
				if ge != nil && domain.Code(ge) != "NOT_FOUND" {
					return ge
				}
				if p.StreamSequence > highest {
					if ge = t.Put(ctx, "catalog", "highest_observed", p.StreamSequence); ge != nil {
						return ge
					}
				}
				return domain.Fail("CATALOG_STREAM_GAP", "Checkpoint is ahead of applied Catalog events")
			}
			if p.StreamSequence == prior.Sequence && m.OccurredAt.After(prior.At) {
				return t.Put(ctx, "catalog", "checkpoint", map[string]any{"sequence": prior.Sequence, "at": m.OccurredAt})
			}
			return nil
		}
		if !domain.Has([]string{"DEPARTMENT", "DOCTOR", "SERVICE", "MEDICINE", "LAB_TEST", "PRICE_VERSION"}, p.EntityType) || !domain.ValidID(p.EntityID) || p.EntityVersion < 1 || len(p.FullSnapshot) == 0 || m.AggregateVersion != p.EntityVersion || (p.EntityType != "PRICE_VERSION" && domain.ID(m.AggregateID) != domain.ID(p.EntityID)) {
			return domain.Fail("INVALID_MESSAGE", "Invalid Catalog stream event")
		}
		if p.StreamSequence <= prior.Sequence {
			return nil
		}
		if p.StreamSequence != prior.Sequence+1 {
			var highest int64
			ge := load(ctx, t, "catalog", "highest_observed", &highest)
			if ge != nil && domain.Code(ge) != "NOT_FOUND" {
				return ge
			}
			if p.StreamSequence > highest {
				if ge = t.Put(ctx, "catalog", "highest_observed", p.StreamSequence); ge != nil {
					return ge
				}
			}
			return domain.Fail("CATALOG_STREAM_GAP", "Catalog stream gap")
		}
		if p.Mode != "CHECKPOINT" {
			if !domain.ValidID(p.EntityID) || p.EntityVersion < 1 || len(p.FullSnapshot) == 0 {
				return domain.Fail("INVALID_MESSAGE", "Invalid catalog entity")
			}
			if p.Mode == "TOMBSTONE" && p.EntityType == "PRICE_VERSION" {
				if p.EffectiveAt.IsZero() {
					return domain.Fail("INVALID_MESSAGE", "Price withdrawal time required")
				}
				var price PriceProjection
				if json.Unmarshal(p.FullSnapshot, &price) != nil || domain.ID(price.PriceVersionID) != domain.ID(p.EntityID) || domain.ID(price.ItemID) != domain.ID(m.AggregateID) || price.Revision > p.EntityVersion || m.AggregateVersion != p.EntityVersion {
					return domain.Fail("INVALID_MESSAGE", "Price withdrawal identity mismatch")
				}
				var previous time.Time
				err := load(ctx, t, "price_withdrawals", domain.ID(p.EntityID), &previous)
				if err != nil && domain.Code(err) != "NOT_FOUND" {
					return err
				}
				if previous.IsZero() || p.EffectiveAt.Before(previous) {
					if err = t.Put(ctx, "price_withdrawals", domain.ID(p.EntityID), p.EffectiveAt); err != nil {
						return err
					}
				}
			}
			if p.Mode == "TOMBSTONE" {
				p.FullSnapshot = json.RawMessage(`{"status":"INACTIVE"}`)
			}
			if p.EntityType == "PRICE_VERSION" && p.Mode == "UPSERT" {
				var price PriceProjection
				if json.Unmarshal(p.FullSnapshot, &price) != nil || !domain.ValidID(price.ItemID) || !domain.ValidID(price.PriceVersionID) || price.Revision < 1 || price.AmountVND < 0 || price.EffectiveFrom.IsZero() {
					return domain.Fail("INVALID_MESSAGE", "Invalid price projection")
				}
				if domain.ID(price.PriceVersionID) != domain.ID(p.EntityID) || domain.ID(price.ItemID) != domain.ID(m.AggregateID) || price.Revision != p.EntityVersion || m.AggregateVersion != p.EntityVersion {
					return domain.Fail("INVALID_MESSAGE", "Price snapshot identity mismatch")
				}
				if price.ItemType == "LAB" {
					var history []PriceProjection
					err := load(ctx, t, "LAB_PRICES", domain.ID(price.ItemID), &history)
					if err != nil && domain.Code(err) != "NOT_FOUND" {
						return err
					}
					found := false
					for _, old := range history {
						if old.PriceVersionID == price.PriceVersionID {
							if domain.Hash(old) != domain.Hash(price) {
								return domain.Fail("INVALID_MESSAGE", "Conflicting price version")
							}
							found = true
						}
					}
					if !found {
						history = append(history, price)
					}
					if err = t.Put(ctx, "LAB_PRICES", domain.ID(price.ItemID), history); err != nil {
						return err
					}
				}
			}
			if !(p.EntityType == "PRICE_VERSION" && p.Mode == "TOMBSTONE") {
				kind := p.EntityType
				if kind == "LAB_TEST" {
					kind = "TEST"
				}
				if p.Mode == "UPSERT" && (kind == "TEST" || kind == "DOCTOR" || kind == "MEDICINE") {
					var entity struct {
						ID       string
						Revision int
					}
					if json.Unmarshal(p.FullSnapshot, &entity) != nil || domain.ID(entity.ID) != domain.ID(p.EntityID) || domain.ID(m.AggregateID) != domain.ID(p.EntityID) || m.AggregateVersion != p.EntityVersion || (kind == "TEST" && entity.Revision != p.EntityVersion) {
						return domain.Fail("INVALID_MESSAGE", "Catalog entity identity mismatch")
					}
				}
				if e = putVersion(ctx, t, kind, domain.ID(p.EntityID), p.EntityVersion, p.FullSnapshot); e != nil {
					return e
				}
			}
		}
		at := prior.At
		if p.Mode == "CHECKPOINT" {
			at = m.OccurredAt
		}
		return t.Put(ctx, "catalog", "checkpoint", map[string]any{"sequence": p.StreamSequence, "at": at})
	}
	return domain.Fail("INVALID_MESSAGE", "Unknown projection")
}
func (s *Service) create(ctx context.Context, t ports.Tx, m domain.Envelope) error {
	var in domain.CreateInput
	if strictJSON(m.Payload, &in) != nil {
		return domain.Fail("INVALID_MESSAGE", "Invalid lab command")
	}
	if e := in.Validate(); e != nil {
		return e
	}
	if domain.ID(in.RequestID) != domain.ID(m.RequestID) || domain.ID(m.AggregateID) != domain.ID(in.RequestID) {
		return domain.Fail("INVALID_MESSAGE", "Registry identity mismatch")
	}
	var old struct{ Hash, OrderID, State, ReasonCode string }
	e := load(ctx, t, "requests", domain.ID(in.RequestID), &old)
	if e == nil {
		if old.Hash != in.RequestHash {
			return domain.Fail("INVALID_MESSAGE", "Request ID content conflict")
		}
		return nil
	}
	if domain.Code(e) != "NOT_FOUND" {
		return e
	}
	var patient struct {
		OwnerUserID string
		Active      bool
	}
	if e = load(ctx, t, "patient", domain.ID(in.PatientID), &patient); e != nil || !domain.ValidID(patient.OwnerUserID) {
		return domain.Fail("SERVICE_UNAVAILABLE", "Patient ownership projection unavailable")
	}
	if !patient.Active {
		return s.rejectCreate(ctx, t, m, in, "PATIENT_INACTIVE")
	}
	var checkpoint struct {
		Sequence int
		At       time.Time
	}
	if e = load(ctx, t, "catalog", "checkpoint", &checkpoint); e != nil || checkpoint.At.IsZero() || s.now().Sub(checkpoint.At) > 30*time.Second || checkpoint.At.After(s.now().Add(time.Second)) {
		return domain.Fail("SERVICE_UNAVAILABLE", "PRICE_PROJECTION_STALE")
	}
	var highest int
	ge := load(ctx, t, "catalog", "highest_observed", &highest)
	if ge != nil && domain.Code(ge) != "NOT_FOUND" {
		return ge
	}
	if highest > checkpoint.Sequence {
		return domain.Fail("SERVICE_UNAVAILABLE", "PRICE_PROJECTION_STALE")
	}
	o := domain.Order{ID: domain.NewID(), RequestID: domain.ID(in.RequestID), RequestHash: in.RequestHash, VisitID: domain.ID(in.VisitID), PatientID: domain.ID(in.PatientID), DoctorID: domain.ID(in.DoctorID), State: "PENDING_PAYMENT", ChargeState: "PENDING", Version: 1, SourceRevision: 1, ChargeRequestID: domain.NewID(), Tests: in.Tests, Specimens: []domain.Specimen{}, CreatedAt: s.now().UTC()}
	for _, test := range in.Tests {
		var def struct {
			ID, Code, Name, Status, Unit, ReferenceRange string
			Revision                                     int
		}
		if e = load(ctx, t, "TEST", domain.ID(test.TestID), &def); e != nil {
			return domain.Fail("SERVICE_UNAVAILABLE", "Test projection unavailable")
		}
		if def.Status != "ACTIVE" || def.Revision != test.Revision || def.Code != test.Code || def.Name != test.Name || def.Unit != test.Unit || def.ReferenceRange != test.ReferenceRange {
			return s.rejectCreate(ctx, t, m, in, "TEST_SNAPSHOT_INVALID")
		}
		price, e := priceAt(ctx, t, domain.ID(test.TestID), in.AuthorizedAt)
		if e != nil {
			return e
		}
		if price.ItemType != "LAB" || price.ItemID != test.TestID || price.AmountVND < 0 || !domain.ValidID(price.PriceVersionID) || price.Revision < 1 || price.EffectiveFrom.After(in.AuthorizedAt) || (price.EffectiveTo != nil && !price.EffectiveTo.After(in.AuthorizedAt)) {
			return s.rejectCreate(ctx, t, m, in, "LAB_PRICE_UNAVAILABLE")
		}
		if o.AmountVND > 9000000000000-price.AmountVND {
			return domain.Fail("INVALID_MESSAGE", "Charge amount exceeds limit")
		}
		o.AmountVND += price.AmountVND
		o.Lines = append(o.Lines, domain.PriceLine{ItemID: test.TestID, Code: test.Code, Name: test.Name, Quantity: 1, UnitPriceVND: price.AmountVND, PriceVersionID: price.PriceVersionID, Revision: price.Revision})
	}
	o.AmountHash = domain.Hash(map[string]any{"linesSnapshot": o.Lines, "amountVnd": o.AmountVND})
	if e = t.SaveOrder(ctx, o); e != nil {
		return e
	}
	if e = t.Put(ctx, "requests", o.RequestID, map[string]any{"hash": in.RequestHash, "orderId": o.ID, "state": "CREATED"}); e != nil {
		return e
	}
	if e = s.emit(ctx, t, m, "COMMAND", "RequestCharge", o.ID, "billing.request-charge.v1", 1, map[string]any{"requestId": o.ChargeRequestID, "sourceType": "LAB_ORDER", "sourceId": o.ID, "sourceRevision": 1, "patientId": o.PatientID, "recipientUserId": patient.OwnerUserID, "linesSnapshot": o.Lines, "amountVnd": o.AmountVND, "snapshotHash": o.AmountHash}); e != nil {
		return e
	}
	return s.emit(ctx, t, m, "EVENT", "LabOrderResolved", in.RequestID, "lab.order-resolved.v1", 1, map[string]any{"requestId": in.RequestID, "visitId": in.VisitID, "state": "CREATED", "orderId": o.ID, "reasonCode": "", "version": 1})
}
func (s *Service) rejectCreate(ctx context.Context, t ports.Tx, m domain.Envelope, in domain.CreateInput, reason string) error {
	if e := t.Put(ctx, "requests", domain.ID(in.RequestID), map[string]any{"hash": in.RequestHash, "state": "REJECTED", "reasonCode": reason}); e != nil {
		return e
	}
	return s.emit(ctx, t, m, "EVENT", "LabOrderResolved", in.RequestID, "lab.order-resolved.v1", 1, map[string]any{"requestId": in.RequestID, "visitId": in.VisitID, "state": "REJECTED", "reasonCode": reason, "version": 1})
}
