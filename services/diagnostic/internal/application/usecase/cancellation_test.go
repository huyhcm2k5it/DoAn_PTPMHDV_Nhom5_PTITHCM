package usecase

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

type grantStore struct{ *memory }
type grantTx struct{ *memory }

func (m grantStore) Within(ctx context.Context, _ string, f func(ports.Tx) error) error {
	return f(grantTx{m.memory})
}
func (t grantTx) VerifyVisitGrant(_ context.Context, _, _ string) error { return nil }

func TestCancellationNeedsGrantAndPreservesSpecimenHistory(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	m := &memory{objects: map[string]json.RawMessage{}}
	doctor := domain.NewID()
	p := domain.Principal{UserID: doctor, ActorType: "DOCTOR", TokenVersion: 1, LeaseAction: "DI-012", LeaseExpiresAt: now.Add(time.Minute)}
	_ = m.Put(ctx, "access", doctor, domain.Access{UserID: doctor, ActorType: "DOCTOR", Status: "ACTIVE", TokenVersion: 1})
	o := domain.Order{ID: domain.NewID(), RequestID: domain.NewID(), VisitID: domain.NewID(), State: "PENDING_PAYMENT", Version: 1}
	m.orders = []domain.Order{o}
	in := domain.CancelInput{ReasonCode: "NOT_NEEDED", ExpectedVersion: 1}
	if _, err := New(m, func() time.Time { return now }).CancelOrder(ctx, p, o.ID, domain.NewID(), in, domain.ResultMeta{CorrelationID: "test"}); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("missing grant accepted: %v", err)
	}
	s := New(grantStore{m}, func() time.Time { return now })
	m.orders[0].Specimens = []domain.Specimen{{ID: domain.NewID(), State: "REJECTED"}}
	if _, err := s.CancelOrder(ctx, p, o.ID, domain.NewID(), in, domain.ResultMeta{CorrelationID: "test"}); domain.Code(err) != "STATE_CONFLICT" {
		t.Fatalf("historical specimen accepted: %v", err)
	}
	m.orders[0].Specimens = nil
	m.orders[0].State = "SETTLEMENT_LOCKED"
	if _, err := s.CancelOrder(ctx, p, o.ID, domain.NewID(), in, domain.ResultMeta{CorrelationID: "test"}); domain.Code(err) != "STATE_CONFLICT" {
		t.Fatalf("locked settlement cancelled: %v", err)
	}
	m.orders[0].State = "PAID"
	m.orders[0].ChargeState = "PAID"
	m.orders[0].SettlementState = "SUCCEEDED"
	key := domain.NewID()
	out, err := s.CancelOrder(ctx, p, o.ID, key, in, domain.ResultMeta{CorrelationID: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if out.Order.State != "CANCELLED" || out.RefundStatus != "PENDING_SYNC" || len(m.out) != 1 || m.out[0].MessageType != "LabCancelled" {
		t.Fatalf("invalid cancellation %+v", out)
	}
	again, err := s.CancelOrder(ctx, p, o.ID, key, in, domain.ResultMeta{CorrelationID: "test"})
	if err != nil || again.Order.Version != out.Order.Version || len(m.out) != 1 {
		t.Fatalf("invalid replay: %v", err)
	}
}

func TestCancellationRejectsChargeOrSettlementStillInFlight(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	m := &memory{objects: map[string]json.RawMessage{}}
	doctor := domain.NewID()
	_ = m.Put(ctx, "access", doctor, domain.Access{UserID: doctor, ActorType: "DOCTOR", Status: "ACTIVE", TokenVersion: 1})
	p := domain.Principal{UserID: doctor, ActorType: "DOCTOR", TokenVersion: 1, LeaseAction: "DI-012", LeaseExpiresAt: now.Add(time.Minute)}
	s := New(grantStore{m}, func() time.Time { return now })
	for _, order := range []domain.Order{
		{ID: domain.NewID(), State: "PENDING_PAYMENT", ChargeState: "PENDING", Version: 1},
		{ID: domain.NewID(), State: "PENDING_PAYMENT", ChargeState: "CREATED", ChargeID: domain.NewID(), Version: 1},
		{ID: domain.NewID(), State: "SETTLEMENT_LOCKED", ChargeState: "CREATED", ChargeID: domain.NewID(), SettlementID: domain.NewID(), SettlementState: "RESERVED", Version: 1},
	} {
		m.orders = []domain.Order{order}
		if _, err := s.CancelOrder(ctx, p, order.ID, domain.NewID(), domain.CancelInput{ReasonCode: "NOT_NEEDED", ExpectedVersion: 1}, domain.ResultMeta{CorrelationID: "test"}); domain.Code(err) != "STATE_CONFLICT" {
			t.Fatalf("cancellation accepted with active charge/settlement %+v: %v", order, err)
		}
	}
}
