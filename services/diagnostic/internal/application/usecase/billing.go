package usecase

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

type settlementDecision struct {
	SettlementID    string `json:"settlementId"`
	SourceID        string `json:"sourceId"`
	SourceRevision  int    `json:"sourceRevision"`
	DecisionVersion int    `json:"decisionVersion"`
	State           string `json:"state"`
	Fence           int    `json:"fence,omitempty"`
	PaymentID       string `json:"paymentId,omitempty"`
}

func (s *Service) billing(ctx context.Context, t ports.Tx, m domain.Envelope) error {
	switch m.MessageType {
	case "BillingStatusChanged":
		var p struct {
			ChargeID, RecipientUserID, PaymentID, State, RefundID, SourceType, SourceID, RefundStatus, AsOf string
			Version                                                                                         int
		}
		if strictJSON(m.Payload, &p) != nil || !domain.ValidID(p.ChargeID) || !domain.ValidID(p.SourceID) || p.SourceType != "LAB_ORDER" || p.Version < 1 {
			return domain.Fail("INVALID_MESSAGE", "Invalid Billing status")
		}
		o, err := orders(ctx, t, p.SourceID)
		if err != nil {
			return domain.Fail("SERVICE_UNAVAILABLE", "Order not synchronized")
		}
		if o.ChargeID != p.ChargeID {
			return domain.Fail("INVALID_MESSAGE", "Billing charge mismatch")
		}
		var prior struct {
			Version int
			Hash    string
		}
		err = load(ctx, t, "billing_status", o.ID, &prior)
		if err != nil && domain.Code(err) != "NOT_FOUND" {
			return err
		}
		if prior.Version > p.Version {
			return nil
		}
		if prior.Version == p.Version {
			if prior.Hash != domain.Hash(p) {
				return domain.Fail("INVALID_MESSAGE", "Billing status version conflict")
			}
			return nil
		}
		o.RefundStatus = p.RefundStatus
		if err = t.SaveOrder(ctx, o); err != nil {
			return err
		}
		return t.Put(ctx, "billing_status", o.ID, struct {
			Version int
			Hash    string
		}{p.Version, domain.Hash(p)})
	case "ChargePrepared":
		var p struct {
			RequestID, SourceType, SourceID, ChargeID, State, ReasonCode string
			SourceRevision                                               int
		}
		if strictJSON(m.Payload, &p) != nil || p.SourceType != "LAB_ORDER" || !domain.ValidID(p.SourceID) || !domain.ValidID(p.RequestID) || !domain.Has([]string{"CREATED", "REJECTED"}, p.State) {
			return domain.Fail("INVALID_MESSAGE", "Invalid charge preparation")
		}
		o, e := orders(ctx, t, p.SourceID)
		if e != nil {
			return domain.Fail("SERVICE_UNAVAILABLE", "Order not synchronized")
		}
		if p.RequestID != o.ChargeRequestID || p.SourceRevision != o.SourceRevision {
			return domain.Fail("INVALID_MESSAGE", "Charge source mismatch")
		}
		if o.ChargeState != "PENDING" {
			if o.ChargeState == "PAID" || (o.ChargeState == p.State && o.ChargeID == p.ChargeID) {
				return nil
			}
			return domain.Fail("INVALID_MESSAGE", "Conflicting charge preparation")
		}
		if p.State == "CREATED" && !domain.ValidID(p.ChargeID) {
			return domain.Fail("INVALID_MESSAGE", "Charge ID required")
		}
		if p.State == "REJECTED" && p.ReasonCode == "" {
			return domain.Fail("INVALID_MESSAGE", "Rejection reason required")
		}
		o.ChargeID = p.ChargeID
		o.ChargeState = p.State
		o.Version++
		return t.SaveOrder(ctx, o)
	case "ReserveSettlement":
		var p struct {
			SettlementID, ChargeID, SourceType, SourceID, AmountHash string
			SourceRevision, AttemptVersion                           int
		}
		if strictJSON(m.Payload, &p) != nil || p.SourceType != "LAB_ORDER" || !domain.ValidID(p.SettlementID) || !domain.ValidID(p.SourceID) || !domain.ValidID(p.ChargeID) || p.SourceRevision < 1 || p.AttemptVersion < 1 {
			return domain.Fail("INVALID_MESSAGE", "Invalid settlement reserve")
		}
		o, e := orders(ctx, t, p.SourceID)
		if e != nil {
			return domain.Fail("SERVICE_UNAVAILABLE", "Order not synchronized")
		}
		reserveHash := domain.Hash(p)
		var saved struct {
			Hash    string
			Payload json.RawMessage
			Version int
		}
		re := load(ctx, t, "reserves", p.SettlementID, &saved)
		if re == nil {
			if saved.Hash != reserveHash {
				return domain.Fail("INVALID_MESSAGE", "Settlement reserve content conflict")
			}
			return s.emit(ctx, t, m, "EVENT", "SettlementReserved", o.ID, "diagnostic.settlement-reserved.v1", saved.Version, saved.Payload)
		}
		if domain.Code(re) != "NOT_FOUND" {
			return re
		}
		if o.ChargeState == "PENDING" {
			return domain.Fail("SERVICE_UNAVAILABLE", "Charge preparation not synchronized")
		}
		var terminal settlementDecision
		te := load(ctx, t, "decisions", p.SettlementID, &terminal)
		if te != nil && domain.Code(te) != "NOT_FOUND" {
			return te
		}
		reason := ""
		if te == nil && terminal.State == "FAILED" {
			reason = "SETTLEMENT_FAILED"
		} else if e = o.Reserve(p.SettlementID, p.ChargeID, p.SourceRevision, p.AmountHash, p.AttemptVersion); e != nil {
			reason = domain.Code(e)
		}
		state := "ACCEPTED"
		payload := map[string]any{"settlementId": p.SettlementID, "sourceId": o.ID, "sourceRevision": p.SourceRevision, "state": state, "reasonCode": reason}
		if reason != "" {
			payload["state"] = "REJECTED"
		} else {
			payload["fence"] = o.Fence
			payload["lockedAt"] = s.now().UTC()
			if e = t.SaveOrder(ctx, o); e != nil {
				return e
			}
		}
		raw, _ := json.Marshal(payload)
		if e = t.Put(ctx, "reserves", p.SettlementID, struct {
			Hash    string
			Payload json.RawMessage
			Version int
		}{reserveHash, raw, o.Version}); e != nil {
			return e
		}
		return s.emit(ctx, t, m, "EVENT", "SettlementReserved", o.ID, "diagnostic.settlement-reserved.v1", o.Version, payload)
	case "SettlementDecision":
		var p settlementDecision
		if strictJSON(m.Payload, &p) != nil || !domain.ValidID(p.SettlementID) || !domain.ValidID(p.SourceID) || p.SourceRevision < 1 || p.DecisionVersion < 1 || !domain.Has([]string{"SUCCEEDED", "FAILED", "UNKNOWN"}, p.State) {
			return domain.Fail("INVALID_MESSAGE", "Invalid settlement decision")
		}
		var prior settlementDecision
		e := load(ctx, t, "decisions", p.SettlementID, &prior)
		if e != nil && domain.Code(e) != "NOT_FOUND" {
			return e
		}
		if e == nil {
			if p.DecisionVersion < prior.DecisionVersion {
				return nil
			}
			if prior.SourceID != p.SourceID || prior.SourceRevision != p.SourceRevision {
				return domain.Fail("INVALID_MESSAGE", "Decision source conflict")
			}
			if prior.State != "UNKNOWN" {
				if prior.State != p.State && p.State != "UNKNOWN" {
					return domain.Fail("INVALID_MESSAGE", "Terminal decision conflict")
				}
				return nil
			}
		}
		o, e := orders(ctx, t, p.SourceID)
		if e != nil {
			return domain.Fail("SERVICE_UNAVAILABLE", "Order not synchronized")
		}
		if p.SourceRevision != o.SourceRevision {
			return nil
		}
		if p.State == "FAILED" && o.SettlementID != p.SettlementID {
			return t.Put(ctx, "decisions", p.SettlementID, p)
		}
		if o.SettlementID != p.SettlementID || o.Fence != p.Fence {
			return nil
		}
		if e = o.Decide(p.SettlementID, p.Fence, p.State); e != nil {
			return e
		}
		if e = t.Put(ctx, "decisions", p.SettlementID, p); e != nil {
			return e
		}
		return t.SaveOrder(ctx, o)
	case "ChargePaid":
		var p struct {
			ChargeID, SourceType, SourceID, SettlementID, TransactionID string
			SourceRevision, Fence                                       int
			AmountVND                                                   int64
			PaidAt                                                      time.Time
		}
		if strictJSON(m.Payload, &p) != nil || p.SourceType != "LAB_ORDER" || !domain.ValidID(p.ChargeID) || !domain.ValidID(p.SourceID) || !domain.ValidID(p.SettlementID) || (strings.TrimSpace(p.TransactionID) == "" || len(p.TransactionID) > 100) || p.PaidAt.IsZero() {
			return domain.Fail("INVALID_MESSAGE", "Invalid paid evidence")
		}
		o, e := orders(ctx, t, p.SourceID)
		if e != nil {
			return domain.Fail("SERVICE_UNAVAILABLE", "Order not synchronized")
		}
		if p.SourceRevision != o.SourceRevision || p.SettlementID != o.SettlementID || p.Fence != o.Fence {
			return nil
		}
		if p.ChargeID != o.ChargeID || p.AmountVND != o.AmountVND {
			return domain.Fail("INVALID_MESSAGE", "Payment snapshot mismatch")
		}
		if e = o.Decide(p.SettlementID, p.Fence, "SUCCEEDED"); e != nil {
			return e
		}
		return t.SaveOrder(ctx, o)
	}
	return domain.Fail("INVALID_MESSAGE", "Unsupported billing message")
}
func (s *Service) Reconcile(ctx context.Context) error {
	return s.store.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		xs, e := t.Orders(ctx)
		if e != nil {
			return e
		}
		for _, o := range xs {
			if o.State != "SETTLEMENT_LOCKED" || s.now().Sub(o.LastQueryAt) < 30*time.Second {
				continue
			}
			request := domain.NewID()
			m := domain.Envelope{MessageID: request, RequestID: request, CorrelationID: request}
			if e = s.emit(ctx, t, m, "COMMAND", "QuerySettlement", o.ID, "billing.query-settlement.v1", o.Version, map[string]any{"requestId": request, "settlementId": o.SettlementID, "sourceType": "LAB_ORDER", "sourceId": o.ID, "sourceRevision": o.SourceRevision}); e != nil {
				return e
			}
			o.LastQueryAt = s.now().UTC()
			if e = t.SaveOrder(ctx, o); e != nil {
				return e
			}
		}
		return nil
	})
}
