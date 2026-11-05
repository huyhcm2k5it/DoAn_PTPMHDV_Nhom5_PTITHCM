package usecase

import (
	"context"
	"encoding/json"
	"testing"
	"time"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

type memory struct {
	objects map[string]json.RawMessage
	orders  []domain.Order
	out     []domain.Envelope
}

func (m *memory) Within(c context.Context, k string, f func(ports.Tx) error) error { return f(m) }
func (m *memory) Get(c context.Context, k, id string) (json.RawMessage, error) {
	b, ok := m.objects[k+":"+id]
	if !ok {
		return nil, domain.Fail("NOT_FOUND", "missing")
	}
	return b, nil
}
func (m *memory) Put(c context.Context, k, id string, v any) error {
	b, e := json.Marshal(v)
	m.objects[k+":"+id] = b
	return e
}
func (m *memory) Orders(context.Context) ([]domain.Order, error) { return m.orders, nil }
func (m *memory) SaveOrder(c context.Context, o domain.Order) error {
	for i, x := range m.orders {
		if x.ID == o.ID {
			m.orders[i] = o
			return nil
		}
	}
	m.orders = append(m.orders, o)
	return nil
}
func (m *memory) Outbox(c context.Context, e domain.Envelope, x, k string) error {
	m.out = append(m.out, e)
	return nil
}
func (m *memory) SeenMessage(context.Context, string, string, string) (bool, error) {
	return false, nil
}
func (m *memory) MarkMessage(context.Context, string, string) error { return nil }
func TestFailedBeforeReserveCannotRelock(t *testing.T) {
	ctx := context.Background()
	m := &memory{objects: map[string]json.RawMessage{}}
	o := domain.Order{ID: domain.NewID(), ChargeID: domain.NewID(), State: "PENDING_PAYMENT", ChargeState: "CREATED", SourceRevision: 1, AmountHash: "h", Version: 1}
	m.orders = []domain.Order{o}
	s := New(m, time.Now)
	id := domain.NewID()
	p := map[string]any{"settlementId": id, "sourceId": o.ID, "sourceRevision": 1, "decisionVersion": 1, "state": "FAILED"}
	b, _ := json.Marshal(p)
	if e := s.billing(ctx, m, domain.Envelope{MessageType: "SettlementDecision", Payload: b}); e != nil {
		t.Fatal(e)
	}
	b, _ = json.Marshal(map[string]any{"settlementId": id, "sourceId": o.ID, "sourceType": "LAB_ORDER", "chargeId": o.ChargeID, "sourceRevision": 1, "amountHash": "h", "attemptVersion": 1})
	if e := s.billing(ctx, m, domain.Envelope{MessageType: "ReserveSettlement", Payload: b}); e != nil {
		t.Fatal(e)
	}
	if m.orders[0].State != "PENDING_PAYMENT" || m.orders[0].Fence != 0 {
		t.Fatal("late reserve relocked failed settlement")
	}
	if len(m.out) != 1 {
		t.Fatal("missing rejection")
	}
}
