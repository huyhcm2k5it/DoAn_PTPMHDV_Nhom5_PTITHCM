package usecase

import (
	"context"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

func (s *Service) HandleTreatmentMessage(ctx context.Context, exchange string, m domain.Envelope) error {
	if m.MessageKind != "EVENT" || m.SchemaVersion != 1 || !domain.ValidID(m.MessageID) || !domain.ValidID(m.AggregateID) || m.AggregateVersion < 1 || m.CorrelationID == "" || len(m.CorrelationID) > 128 || !domain.ValidID(m.RequestID) || m.OccurredAt.IsZero() {
		return domain.Fail("INVALID_MESSAGE", "Invalid treatment message envelope")
	}
	switch m.MessageType {
	case "CatalogChanged":
		return s.handleCatalogChanged(ctx, exchange, m)
	case "LabOrderResolved":
		if exchange != "umc.events.diagnostic.v1" || m.Producer != "diagnostic" || !domain.ValidID(m.CausationID) {
			return domain.Fail("INVALID_MESSAGE", "Untrusted Diagnostic producer")
		}
		var p struct {
			RequestID  string `json:"requestId"`
			VisitID    string `json:"visitId"`
			State      string `json:"state"`
			OrderID    string `json:"orderId"`
			ReasonCode string `json:"reasonCode"`
			Version    int    `json:"version"`
		}
		if strictJSON(m.Payload, &p) != nil || !domain.ValidID(p.RequestID) || !domain.ValidID(p.VisitID) || p.Version < 1 || (p.State != "CREATED" && p.State != "REJECTED") || (p.State == "CREATED" && !domain.ValidID(p.OrderID)) || (p.State == "REJECTED" && (p.ReasonCode == "" || p.OrderID != "")) {
			return domain.Fail("INVALID_MESSAGE", "Invalid LabOrderResolved")
		}
		if domain.ID(m.RequestID) != domain.ID(p.RequestID) || domain.ID(m.AggregateID) != domain.ID(p.RequestID) || m.AggregateVersion != p.Version {
			return domain.Fail("INVALID_MESSAGE", "LAB resolution envelope does not match registry request")
		}
		return s.store.Within(ctx, "visit:"+domain.ID(p.VisitID), func(base ports.ClinicalTx) error {
			tx, e := treatment(base)
			if e != nil {
				return e
			}
			seen, e := tx.SeenMessage(ctx, m.MessageID, domain.Hash(m), retryLease(ctx))
			if e != nil || seen {
				return e
			}
			r, e := tx.LabRequest(ctx, domain.ID(p.RequestID))
			if e != nil {
				return e
			}
			if r.VisitID != domain.ID(p.VisitID) {
				return domain.Fail("INVALID_MESSAGE", "Lab request visit mismatch")
			}
			v, e := tx.Visit(ctx, r.VisitID)
			if e != nil {
				return e
			}
			if r.State != "PENDING" {
				if r.State != p.State || r.OrderID != domain.ID(p.OrderID) || r.ReasonCode != p.ReasonCode || r.SourceVersion != p.Version {
					return domain.Fail("STATE_CONFLICT", "Conflicting LAB resolution")
				}
				return tx.MarkMessage(ctx, m.MessageID, domain.Hash(m))
			}
			r.State = p.State
			r.OrderID = domain.ID(p.OrderID)
			r.ReasonCode = p.ReasonCode
			r.SourceVersion = p.Version
			if e = tx.SaveLabRequest(ctx, r); e != nil {
				return e
			}
			all, e := tx.LabRequests(ctx, v.ID)
			if e != nil {
				return e
			}
			state := "IN_PROGRESS"
			for _, x := range all {
				if x.State == "PENDING" {
					state = "LAB_REQUEST_PENDING"
					break
				}
				if x.State == "CREATED" {
					state = "WAITING_LAB"
				}
			}
			if v.State != "SIGNED" {
				v.State = state
				v.Version++
				if e = tx.UpdateVisit(ctx, v); e != nil {
					return e
				}
			}
			return tx.MarkMessage(ctx, m.MessageID, domain.Hash(m))
		})
	}
	return domain.Fail("INVALID_MESSAGE", "Unsupported treatment event")
}
