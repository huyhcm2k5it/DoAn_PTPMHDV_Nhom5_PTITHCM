package usecase

import (
	"context"
	"encoding/json"
	"testing"
	"time"
	"umccare/diagnostic/internal/domain"
)

func TestBillingStatusProjectionDoesNotRollBack(t *testing.T) {
	o := domain.Order{ID: domain.NewID(), ChargeID: domain.NewID(), State: "CANCELLED", Version: 1}
	m := &memory{objects: map[string]json.RawMessage{}, orders: []domain.Order{o}}
	s := New(m, time.Now)
	userID, refundID := domain.NewID(), domain.NewID()
	for _, v := range []struct {
		Version int
		State   string
	}{{1, "REQUESTED"}, {2, "FAILED"}, {3, "SUCCEEDED"}, {2, "FAILED"}, {4, ""}} {
		body, _ := json.Marshal(map[string]any{"recipientUserId": userID, "refundId": refundID, "chargeId": o.ChargeID, "sourceId": o.ID, "sourceType": "LAB_ORDER", "version": v.Version, "state": "REFUNDED", "refundStatus": v.State})
		if err := s.billing(context.Background(), m, domain.Envelope{MessageType: "BillingStatusChanged", Payload: body}); err != nil {
			t.Fatal(err)
		}
	}
	b, _ := json.Marshal(m.orders[0])
	var dto map[string]any
	json.Unmarshal(b, &dto)
	if dto["refundStatus"] != "SUCCEEDED" {
		t.Fatal("Older status overwrote successful refund")
	}
}
