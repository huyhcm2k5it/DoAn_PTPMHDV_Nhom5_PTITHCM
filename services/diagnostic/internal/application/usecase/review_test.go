package usecase

import (
	"context"
	"encoding/json"
	"testing"
	"time"
	"umccare/diagnostic/internal/domain"
)

func TestReserveOutcomeStable(t *testing.T) {
	ctx := context.Background()
	m := &memory{objects: map[string]json.RawMessage{}}
	o := domain.Order{ID: domain.NewID(), ChargeID: domain.NewID(), State: "PENDING_PAYMENT", ChargeState: "CREATED", SourceRevision: 1, AmountHash: "h", Version: 1}
	m.orders = []domain.Order{o}
	s := New(m, time.Now)
	reserve := func(id string) error {
		b, _ := json.Marshal(map[string]any{"settlementId": id, "sourceId": o.ID, "sourceType": "LAB_ORDER", "chargeId": o.ChargeID, "sourceRevision": 1, "amountHash": "h", "attemptVersion": 1})
		return s.billing(ctx, m, domain.Envelope{MessageType: "ReserveSettlement", Payload: b})
	}
	a, b := domain.NewID(), domain.NewID()
	if e := reserve(a); e != nil {
		t.Fatal(e)
	}
	if e := reserve(b); e != nil {
		t.Fatal(e)
	}
	first := string(m.out[1].Payload)
	m.orders[0].State = "PENDING_PAYMENT"
	m.orders[0].SettlementState = "FAILED"
	if e := reserve(b); e != nil {
		t.Fatal(e)
	}
	if string(m.out[2].Payload) != first {
		t.Fatal("reserve outcome changed", first, string(m.out[2].Payload))
	}
}
func TestReserveBeforeChargePreparationRetries(t *testing.T) {
	m := &memory{objects: map[string]json.RawMessage{}}
	id := domain.NewID()
	m.orders = []domain.Order{{ID: id, State: "PENDING_PAYMENT", ChargeState: "PENDING", SourceRevision: 1}}
	b, _ := json.Marshal(map[string]any{"settlementId": domain.NewID(), "sourceId": id, "sourceType": "LAB_ORDER", "chargeId": domain.NewID(), "sourceRevision": 1, "amountHash": "h", "attemptVersion": 1})
	if e := New(m, time.Now).billing(context.Background(), m, domain.Envelope{MessageType: "ReserveSettlement", Payload: b}); domain.Code(e) != "SERVICE_UNAVAILABLE" {
		t.Fatal("missing charge projection permanently rejected", e)
	}
}
func TestPriceTombstoneStopsCurrentQuote(t *testing.T) {
	ctx := context.Background()
	m := &memory{objects: map[string]json.RawMessage{}}
	s := New(m, time.Now)
	item, price := domain.NewID(), domain.NewID()
	now := time.Now().UTC()
	m.Put(ctx, "catalog", "checkpoint", map[string]any{"sequence": 1, "at": now})
	p := PriceProjection{ItemID: item, PriceVersionID: price, ItemType: "LAB", AmountVND: 5, Revision: 1, EffectiveFrom: now.Add(-time.Hour)}
	m.Put(ctx, "LAB_PRICES", item, []PriceProjection{p})
	raw, _ := json.Marshal(map[string]any{"entityType": "PRICE_VERSION", "entityId": price, "entityVersion": 1, "fullSnapshot": p, "effectiveAt": now, "streamSequence": 2, "mode": "TOMBSTONE"})
	e := s.project(ctx, m, domain.Envelope{MessageType: "CatalogChanged", AggregateID: item, AggregateVersion: 1, Payload: raw, OccurredAt: now})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = priceAt(ctx, m, item, now.Add(time.Second)); domain.Code(e) != "SERVICE_UNAVAILABLE" {
		t.Fatal("withdrawn price still selected", e)
	}
	if _, e = priceAt(ctx, m, item, now.Add(-time.Second)); e != nil {
		t.Fatal("historical price lost", e)
	}
}
