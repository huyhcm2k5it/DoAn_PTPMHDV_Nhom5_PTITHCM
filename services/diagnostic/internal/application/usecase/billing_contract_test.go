package usecase

import (
	"context"
	"encoding/json"
	"testing"
	"time"
	"umccare/diagnostic/internal/domain"
)

func TestTextTransactionIDAccepted(t *testing.T) {
	ctx := context.Background()
	o := domain.Order{ID: domain.NewID(), ChargeID: domain.NewID(), SettlementID: domain.NewID(), SourceRevision: 1, Fence: 1, AmountVND: 120000, State: "SETTLEMENT_LOCKED", SettlementState: "RESERVED", Version: 1}
	m := &memory{objects: map[string]json.RawMessage{}, orders: []domain.Order{o}}
	s := New(m, time.Now)
	b, _ := json.Marshal(map[string]any{"chargeId": o.ChargeID, "sourceType": "LAB_ORDER", "sourceId": o.ID, "settlementId": o.SettlementID, "transactionId": "TXN_123", "sourceRevision": 1, "fence": 1, "amountVND": 120000, "paidAt": time.Now().UTC()})
	if err := s.billing(ctx, m, domain.Envelope{MessageType: "ChargePaid", Payload: b}); err != nil {
		t.Fatal(err)
	}
	if m.orders[0].State != "PAID" {
		t.Fatal("matching payment evidence did not unlock paid order")
	}
}
