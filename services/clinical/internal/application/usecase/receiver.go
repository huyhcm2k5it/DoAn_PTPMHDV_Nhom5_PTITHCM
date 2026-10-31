package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math/rand/v2"
	"time"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

type EventHandler interface {
	HandleClaim(context.Context, string, domain.Envelope) error
	HandleProjection(context.Context, string, domain.Envelope) error
}
type Receiver struct {
	handler EventHandler
	store   ports.DeliveryStore
}
type retryLeaseKey struct{}

func retryLease(ctx context.Context) string {
	value, _ := ctx.Value(retryLeaseKey{}).(string)
	return value
}

func strictJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return domain.Fail("INVALID_MESSAGE", "Exactly one JSON object required")
	}
	return nil
}
func NewReceiver(handler EventHandler, store ports.DeliveryStore) *Receiver {
	return &Receiver{handler: handler, store: store}
}
func (r *Receiver) Receive(ctx context.Context, d ports.Incoming) error {
	var event domain.Envelope
	invalid := func() error { return r.store.Quarantine(ctx, d, "INVALID_MESSAGE") }
	if d.Attempt < 0 || d.Attempt > 3 || len(d.Body) > 1<<20 || strictJSON(d.Body, &event) != nil || !domain.ValidID(event.MessageID) || (d.MessageID != "" && domain.ID(d.MessageID) != domain.ID(event.MessageID)) {
		return invalid()
	}
	d.MessageID = domain.ID(event.MessageID)
	if d.Attempt > 0 {
		if !domain.ValidID(d.LeaseID) {
			return invalid()
		}
		ctx = context.WithValue(ctx, retryLeaseKey{}, domain.ID(d.LeaseID))
	}
	var err error
	switch {
	case event.MessageType == "QueueTicketClaimed" && d.Exchange == "umc.events.appointment.v1" && d.RoutingKey == "appointment.queue-ticket-claimed.v1":
		err = r.handler.HandleClaim(ctx, d.Exchange, event)
	case event.MessageType == "IdentityAccessChanged" && d.Exchange == "umc.events.identity.v1" && d.RoutingKey == "identity.identity-access-changed.v1":
		err = r.handler.HandleProjection(ctx, d.Exchange, event)
	case event.MessageType == "PatientAccessChanged" && d.Exchange == "umc.events.patient.v1" && d.RoutingKey == "patient.patient-access-changed.v1":
		err = r.handler.HandleProjection(ctx, d.Exchange, event)
	default:
		return invalid()
	}
	if err == nil {
		return nil
	}
	if domain.Code(err) != "SERVICE_UNAVAILABLE" {
		return r.store.Quarantine(ctx, d, domain.Code(err))
	}
	if d.Attempt >= 3 {
		return r.store.Quarantine(ctx, d, "RETRY_EXHAUSTED")
	}
	delays := []time.Duration{5 * time.Second, 15 * time.Second, 60 * time.Second}
	return r.store.ScheduleRetry(ctx, d, d.Attempt+1, delays[d.Attempt]+time.Duration(rand.IntN(1000))*time.Millisecond)
}

func (s *Service) HandleProjection(ctx context.Context, exchange string, event domain.Envelope) error {
	if event.MessageKind != "EVENT" || event.SchemaVersion != 1 || !domain.ValidID(event.MessageID) || !domain.ValidID(event.AggregateID) || event.AggregateVersion < 1 || event.CorrelationID == "" || len(event.CorrelationID) > 128 || !domain.ValidID(event.CausationID) || !domain.ValidID(event.RequestID) || event.OccurredAt.IsZero() {
		return domain.Fail("INVALID_MESSAGE", "Invalid projection envelope")
	}
	return s.store.Within(ctx, "projection:"+event.Producer+":"+domain.ID(event.AggregateID), func(tx ports.ClinicalTx) error {
		hash := domain.Hash(event)
		seen, e := tx.SeenMessage(ctx, domain.ID(event.MessageID), hash, retryLease(ctx))
		if e != nil || seen {
			return e
		}
		switch {
		case exchange == "umc.events.identity.v1" && event.Producer == "identity" && event.MessageType == "IdentityAccessChanged":
			var p struct {
				UserID, Status, ActorType string
				TokenVersion              *int
				Version                   int
				Capabilities              []string
				PhoneVerified             *bool
			}
			if strictJSON(event.Payload, &p) != nil || !domain.ValidID(p.UserID) || domain.ID(p.UserID) != domain.ID(event.AggregateID) || p.Version != event.AggregateVersion || p.Version < 1 || p.TokenVersion == nil || *p.TokenVersion < 0 || *p.TokenVersion > 2147483647 || p.Capabilities == nil || p.PhoneVerified == nil || (p.ActorType != "DOCTOR" && p.ActorType != "PATIENT" && p.ActorType != "STAFF") || p.Status == "" || len(p.Status) > 32 {
				return domain.Fail("INVALID_MESSAGE", "Invalid Identity projection")
			}
			e = tx.UpdateAccess(ctx, domain.Access{UserID: domain.ID(p.UserID), ActorType: p.ActorType, Status: p.Status, TokenVersion: *p.TokenVersion}, p.Version)
		case exchange == "umc.events.patient.v1" && event.Producer == "patient" && event.MessageType == "PatientAccessChanged":
			var p struct {
				PatientID, OwnerUserID string
				Active                 *bool
				PolicyVersion          int
			}
			if strictJSON(event.Payload, &p) != nil || !domain.ValidID(p.PatientID) || !domain.ValidID(p.OwnerUserID) || p.Active == nil || domain.ID(p.PatientID) != domain.ID(event.AggregateID) || p.PolicyVersion != event.AggregateVersion || p.PolicyVersion < 1 {
				return domain.Fail("INVALID_MESSAGE", "Invalid Patient projection")
			}
			e = tx.UpdatePatientAccess(ctx, domain.PatientAccess{PatientID: domain.ID(p.PatientID), OwnerUserID: domain.ID(p.OwnerUserID), Active: *p.Active, PolicyVersion: p.PolicyVersion})
		default:
			return domain.Fail("INVALID_MESSAGE", "Untrusted projection producer")
		}
		if e != nil {
			return e
		}
		return tx.MarkMessage(ctx, domain.ID(event.MessageID), hash)
	})
}
