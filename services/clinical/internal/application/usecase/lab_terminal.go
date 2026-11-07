package usecase

import (
	"context"
	"time"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

func (s *Service) handleLabTerminal(ctx context.Context, exchange string, m domain.Envelope) error {
	if exchange != "umc.events.diagnostic.v1" || m.Producer != "diagnostic" || !domain.ValidID(m.CausationID) {
		return domain.Fail("INVALID_MESSAGE", "Untrusted Diagnostic terminal event")
	}
	var order, visit, state, hash string
	var version int
	var revision int
	var publishedAt time.Time
	if m.MessageType == "LabResultPublished" {
		var p struct {
			OrderID         string    `json:"orderId"`
			VisitID         string    `json:"visitId"`
			Revision        int       `json:"revision"`
			PublishedAt     time.Time `json:"publishedAt"`
			RecipientUserID string    `json:"recipientUserId"`
			Version         int       `json:"version"`
		}
		if strictJSON(m.Payload, &p) != nil || p.Revision < 1 || p.Revision > 2147483647 || p.PublishedAt.IsZero() || !domain.ValidID(p.RecipientUserID) {
			return domain.Fail("INVALID_MESSAGE", "Invalid published LAB event")
		}
		order, visit, version, state = p.OrderID, p.VisitID, p.Version, "PUBLISHED"
		revision, publishedAt = p.Revision, p.PublishedAt.UTC().Truncate(time.Microsecond)
		hash = domain.Hash(p)
	} else {
		var p struct {
			OrderID        string `json:"orderId"`
			VisitID        string `json:"visitId"`
			CancellationID string `json:"cancellationId"`
			NoSpecimen     *bool  `json:"noSpecimen"`
			ReasonCode     string `json:"reasonCode"`
			Version        int    `json:"version"`
		}
		if strictJSON(m.Payload, &p) != nil || !domain.ValidID(p.CancellationID) || p.NoSpecimen == nil || !*p.NoSpecimen || p.ReasonCode == "" || len(p.ReasonCode) > 128 {
			return domain.Fail("INVALID_MESSAGE", "Invalid cancelled LAB event")
		}
		order, visit, version, state = p.OrderID, p.VisitID, p.Version, "CANCELLED"
		hash = domain.Hash(p)
	}
	if !domain.ValidID(order) || !domain.ValidID(visit) || domain.ID(order) != domain.ID(m.AggregateID) || version < 1 || version > 2147483647 || version != m.AggregateVersion {
		return domain.Fail("INVALID_MESSAGE", "LAB terminal event identity mismatch")
	}
	request, order, visit := domain.ID(m.RequestID), domain.ID(order), domain.ID(visit)
	return s.store.Within(ctx, "visit:"+visit, func(base ports.ClinicalTx) error {
		tx, err := treatment(base)
		if err != nil {
			return err
		}
		seen, err := tx.SeenMessage(ctx, m.MessageID, domain.Hash(m), retryLease(ctx))
		if err != nil || seen {
			return err
		}
		r, err := tx.LabRequest(ctx, request)
		if err != nil {
			return err
		}
		if r.VisitID != visit {
			return domain.Fail("INVALID_MESSAGE", "LAB request visit mismatch")
		}
		v, err := tx.Visit(ctx, visit)
		if err != nil {
			return err
		}
		if r.State == "REJECTED" || (r.State != "PENDING" && r.OrderID != order) {
			return domain.Fail("STATE_CONFLICT", "LAB order does not match registry")
		}
		terminal := domain.LabTerminal{RequestID: request, VisitID: visit, OrderID: order, State: state, Hash: hash, Revision: revision, PublishedAt: publishedAt}
		if err = tx.SaveLabTerminal(ctx, terminal); err != nil {
			return err
		}
		if r.State == "PENDING" {
			return tx.MarkMessage(ctx, m.MessageID, domain.Hash(m))
		}
		if r.State != "CREATED" && r.State != state {
			return domain.Fail("STATE_CONFLICT", "LAB already reached a different terminal state")
		}
		if r.State == "CREATED" {
			r.State = state
			if err = tx.SaveLabRequest(ctx, r); err != nil {
				return err
			}
			if err = s.refreshLabVisit(ctx, tx, v, m); err != nil {
				return err
			}
		}
		return tx.MarkMessage(ctx, m.MessageID, domain.Hash(m))
	})
}

func (s *Service) refreshLabVisit(ctx context.Context, tx ports.TreatmentTx, v domain.Visit, cause domain.Envelope) error {
	if v.State == "SIGNED" {
		return nil
	}
	all, err := tx.LabRequests(ctx, v.ID)
	if err != nil {
		return err
	}
	state, terminal := "IN_PROGRESS", false
	for _, r := range all {
		if r.State == "PENDING" {
			state = "LAB_REQUEST_PENDING"
			break
		}
		if r.State == "CREATED" {
			state = "WAITING_LAB"
		}
		if r.State == "PUBLISHED" || r.State == "CANCELLED" {
			terminal = true
		}
	}
	makeReturn := state == "IN_PROGRESS" && terminal && v.ReturnRound == 0 && v.State != "RETURN_READY" && v.State != "WAITING_RETURN"
	if makeReturn {
		state = "RETURN_READY"
	}
	if v.State == "RETURN_READY" || v.State == "WAITING_RETURN" {
		return nil
	}
	if v.State == state {
		return nil
	}
	v.State = state
	v.Version++
	if err = tx.UpdateVisit(ctx, v); err != nil {
		return err
	}
	if makeReturn {
		message := s.event(v, "VisitReturnReady", "EVENT", map[string]any{"visitId": v.ID, "appointmentId": v.AppointmentID, "returnRound": 1, "version": v.Version}, domain.Meta{CorrelationID: cause.CorrelationID, RequestID: cause.RequestID})
		message.CausationID = cause.MessageID
		return tx.AppendMessage(ctx, message, "umc.events.clinical.v1", "clinical.visit-return-ready.v1")
	}
	return nil
}
