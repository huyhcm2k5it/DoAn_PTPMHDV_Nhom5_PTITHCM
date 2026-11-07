package usecase

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

type Service struct {
	store ports.Store
	now   func() time.Time
}

func New(s ports.Store, now func() time.Time) *Service { return &Service{s, now} }
func load(ctx context.Context, t ports.Tx, kind, key string, v any) error {
	b, e := t.Get(ctx, kind, key)
	if e != nil {
		return e
	}
	return json.Unmarshal(b, v)
}
func authorize(ctx context.Context, t ports.Tx, p domain.Principal, read bool) error {
	if !domain.ValidID(p.UserID) {
		return domain.Fail("UNAUTHENTICATED", "Authentication required")
	}
	var a domain.Access
	if e := load(ctx, t, "access", domain.ID(p.UserID), &a); e != nil {
		return domain.Fail("SERVICE_UNAVAILABLE", "Identity projection unavailable")
	}
	if a.Status != "ACTIVE" || a.ActorType != p.ActorType || a.TokenVersion != p.TokenVersion {
		return domain.Fail("FORBIDDEN", "Access revoked")
	}
	if p.ActorType == "DOCTOR" && read {
		return nil
	}
	if p.ActorType == "STAFF" && ((domain.Has(a.Capabilities, "LAB_TECH") && domain.Has(p.Capabilities, "LAB_TECH")) || (read && domain.Has(a.Capabilities, "LAB_REVIEW") && domain.Has(p.Capabilities, "LAB_REVIEW"))) {
		return nil
	}
	return domain.Fail("FORBIDDEN", "LAB capability required")
}
func orders(ctx context.Context, t ports.Tx, id string) (domain.Order, error) {
	xs, e := t.Orders(ctx)
	if e != nil {
		return domain.Order{}, e
	}
	for _, o := range xs {
		if o.ID == domain.ID(id) {
			return o, nil
		}
	}
	return domain.Order{}, domain.Fail("NOT_FOUND", "Order not found")
}
func (s *Service) List(ctx context.Context, p domain.Principal, q domain.Query) (out domain.List, e error) {
	out.Items = []domain.Order{}
	if q.Page < 1 || q.Limit < 1 || q.Limit > 100 || q.Page > 1000000 {
		return out, domain.Fail("VALIDATION_ERROR", "Invalid pagination")
	}
	if q.State != "" && !domain.Has([]string{"PENDING_PAYMENT", "SETTLEMENT_LOCKED", "PAID", "SPECIMEN_COLLECTED", "SPECIMEN_REJECTED", "CANCELLED", "PUBLISHED"}, q.State) {
		return out, domain.Fail("VALIDATION_ERROR", "Invalid order state")
	}
	e = s.store.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		if p.ActorType != "STAFF" {
			return domain.Fail("FORBIDDEN", "Staff queue only")
		}
		if e := authorize(ctx, t, p, true); e != nil {
			return e
		}
		xs, e := t.Orders(ctx)
		if e != nil {
			return e
		}
		for _, o := range xs {
			if q.State == "" || o.State == q.State {
				out.Items = append(out.Items, o)
			}
		}
		sort.Slice(out.Items, func(i, j int) bool { return out.Items[i].CreatedAt.After(out.Items[j].CreatedAt) })
		out.Total = len(out.Items)
		start := (q.Page - 1) * q.Limit
		if start > out.Total {
			start = out.Total
		}
		end := start + q.Limit
		if end > out.Total {
			end = out.Total
		}
		out.Items = out.Items[start:end]
		return nil
	})
	return
}
func (s *Service) Detail(ctx context.Context, p domain.Principal, id string) (out domain.Detail, e error) {
	if !domain.ValidID(id) {
		return out, domain.Fail("VALIDATION_ERROR", "UUID required")
	}
	e = s.store.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		if e := authorize(ctx, t, p, true); e != nil {
			return e
		}
		o, e := orders(ctx, t, id)
		if e != nil {
			return e
		}
		if p.ActorType == "DOCTOR" {
			verifier, ok := t.(ports.VisitGrantVerifier)
			if !ok {
				return domain.Fail("SERVICE_UNAVAILABLE", "Current doctor-visit grant projection unavailable")
			}
			if err := verifier.VerifyVisitGrant(ctx, o.VisitID, domain.ID(p.UserID)); err != nil {
				return err
			}
			var mapping struct {
				IdentityUserID string `json:"identityUserId"`
			}
			if err := load(ctx, t, "DOCTOR", o.DoctorID, &mapping); err != nil {
				return domain.Fail("SERVICE_UNAVAILABLE", "Doctor projection unavailable")
			}
			if domain.ID(mapping.IdentityUserID) != domain.ID(p.UserID) {
				return domain.Fail("NOT_FOUND", "Order not found")
			}
		}
		out = domain.Detail{Order: o, Specimens: o.Specimens, Results: []domain.Result{}}
		if out.Specimens == nil {
			out.Specimens = []domain.Specimen{}
		}
		var resultID string
		if e = load(ctx, t, "result-order", o.ID, &resultID); e == nil {
			var r resultRecord
			if e = load(ctx, t, "result", resultID, &r); e != nil {
				return e
			}
			if p.ActorType != "DOCTOR" || r.Result.State == "PUBLISHED" {
				out.Results = append(out.Results, r.Result)
			}
		} else if domain.Code(e) != "NOT_FOUND" {
			return e
		}
		return nil
	})
	return
}

type Replay struct {
	Hash     string          `json:"hash"`
	Response json.RawMessage `json:"response"`
}

func replay(ctx context.Context, t ports.Tx, key, hash string, out any) (bool, error) {
	var r Replay
	e := load(ctx, t, "replay", key, &r)
	if domain.Code(e) == "NOT_FOUND" {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	if r.Hash != hash {
		return false, domain.Fail("IDEMPOTENCY_CONFLICT", "Key belongs to different request")
	}
	return true, json.Unmarshal(r.Response, out)
}
func saveReplay(ctx context.Context, t ports.Tx, key, hash string, out any) error {
	b, e := json.Marshal(out)
	if e != nil {
		return e
	}
	return t.Put(ctx, "replay", key, Replay{hash, b})
}
func (s *Service) Sample(ctx context.Context, p domain.Principal, id, key string, in domain.SampleInput, recollect bool) (out domain.Specimen, e error) {
	if !domain.ValidID(id) || !domain.ValidID(key) || len(in.Barcode) > 128 || strings.ContainsAny(in.Barcode, "\r\n\t") {
		return out, domain.Fail("VALIDATION_ERROR", "Invalid specimen request")
	}
	op := "collect"
	if recollect {
		op = "recollect"
	}
	hash := domain.Hash(map[string]any{"id": domain.ID(id), "input": in})
	rk := domain.ID(p.UserID) + ":" + op + ":" + domain.ID(key)
	e = s.store.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		if e := authorize(ctx, t, p, false); e != nil {
			return e
		}
		found, e := replay(ctx, t, rk, hash, &out)
		if e != nil || found {
			return e
		}
		o, e := orders(ctx, t, id)
		if e != nil {
			return e
		}
		if e = o.CanCollect(recollect); e != nil {
			return e
		}
		barcode := strings.TrimSpace(in.Barcode)
		if barcode == "" {
			barcode = "LAB-" + domain.NewID()
		}
		for _, existing := range o.Specimens {
			if existing.Barcode == barcode {
				return domain.Fail("STATE_CONFLICT", "Barcode already in use")
			}
		}
		out = domain.Specimen{ID: domain.NewID(), OrderID: o.ID, State: "COLLECTED", Sequence: len(o.Specimens) + 1, Barcode: barcode, Version: 1, CollectedBy: domain.ID(p.UserID), CollectedAt: s.now().UTC()}
		o.Specimens = append(o.Specimens, out)
		o.State = "SPECIMEN_COLLECTED"
		o.Version++
		if e = t.SaveOrder(ctx, o); e != nil {
			return e
		}
		return saveReplay(ctx, t, rk, hash, out)
	})
	return
}
func (s *Service) Reject(ctx context.Context, p domain.Principal, id, key string, in domain.RejectInput) (out domain.Specimen, e error) {
	if !domain.ValidID(id) || !domain.ValidID(key) || in.ExpectedVersion < 1 || strings.TrimSpace(in.ReasonCode) == "" || len(in.ReasonCode) > 128 {
		return out, domain.Fail("VALIDATION_ERROR", "Reason and expectedVersion required")
	}
	hash := domain.Hash(map[string]any{"id": domain.ID(id), "input": in})
	rk := domain.ID(p.UserID) + ":reject:" + domain.ID(key)
	e = s.store.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		if e := authorize(ctx, t, p, false); e != nil {
			return e
		}
		found, e := replay(ctx, t, rk, hash, &out)
		if e != nil || found {
			return e
		}
		xs, e := t.Orders(ctx)
		if e != nil {
			return e
		}
		for _, o := range xs {
			for n, sp := range o.Specimens {
				if sp.ID != domain.ID(id) {
					continue
				}
				if o.State != "SPECIMEN_COLLECTED" || sp.State != "COLLECTED" || sp.Version != in.ExpectedVersion || n != len(o.Specimens)-1 {
					return domain.Fail("SPECIMEN_ALREADY_PROCESSED", "Specimen changed or was processed")
				}
				var resultID string
				if e = load(ctx, t, "result-order", o.ID, &resultID); e == nil {
					return domain.Fail("SPECIMEN_ALREADY_PROCESSED", "Specimen has a result")
				} else if domain.Code(e) != "NOT_FOUND" {
					return e
				}
				sp.State = "REJECTED"
				sp.ReasonCode = in.ReasonCode
				sp.Version++
				o.Specimens[n] = sp
				o.State = "SPECIMEN_REJECTED"
				o.Version++
				out = sp
				if e = t.SaveOrder(ctx, o); e != nil {
					return e
				}
				return saveReplay(ctx, t, rk, hash, out)
			}
		}
		return domain.Fail("NOT_FOUND", "Specimen not found")
	})
	return
}
func (s *Service) emit(ctx context.Context, t ports.Tx, in domain.Envelope, kind, typ, aggregate, route string, version int, payload any) error {
	b, e := json.Marshal(payload)
	if e != nil {
		return e
	}
	m := domain.Envelope{MessageID: domain.NewID(), MessageKind: kind, MessageType: typ, SchemaVersion: 1, Producer: "diagnostic", AggregateID: aggregate, AggregateVersion: version, CorrelationID: in.CorrelationID, CausationID: in.MessageID, RequestID: in.RequestID, OccurredAt: s.now().UTC(), Payload: b}
	exchange := "umc.events.diagnostic.v1"
	if kind == "COMMAND" {
		exchange = "umc.commands.diagnostic.v1"
	}
	return t.Outbox(ctx, m, exchange, route)
}
