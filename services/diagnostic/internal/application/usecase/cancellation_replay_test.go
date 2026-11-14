package usecase

import (
	"context"
	"encoding/json"
	"testing"
	"time"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

type changingGrant struct{ canCancel, revoked bool }
type changingGrantStore struct {
	*memory
	grant *changingGrant
}
type changingGrantTx struct {
	*memory
	grant *changingGrant
}

func (s changingGrantStore) Within(ctx context.Context, _ string, fn func(ports.Tx) error) error {
	return fn(changingGrantTx{s.memory, s.grant})
}
func (t changingGrantTx) VerifyVisitGrant(_ context.Context, _, _, _ string, cancel bool, _ time.Time) error {
	if t.grant.revoked {
		return domain.Fail("NOT_FOUND", "Order not found")
	}
	if cancel && !t.grant.canCancel {
		return domain.Fail("STATE_CONFLICT", "Signed visit cannot cancel LAB")
	}
	return nil
}
func TestCancellationRetryAfterSigningStillRequiresCurrentReadGrant(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	m := &memory{objects: map[string]json.RawMessage{}}
	doctor := domain.NewID()
	_ = m.Put(ctx, "access", doctor, domain.Access{UserID: doctor, ActorType: "DOCTOR", Status: "ACTIVE", TokenVersion: 1})
	o := domain.Order{ID: domain.NewID(), RequestID: domain.NewID(), VisitID: domain.NewID(), PatientID: domain.NewID(), State: "PAID", ChargeState: "PAID", SettlementState: "SUCCEEDED", Version: 1}
	m.orders = []domain.Order{o}
	g := &changingGrant{canCancel: true}
	s := New(changingGrantStore{m, g}, func() time.Time { return now })
	p := domain.Principal{UserID: doctor, ActorType: "DOCTOR", TokenVersion: 1, LeaseAction: "DI-012", LeaseExpiresAt: now.Add(time.Minute)}
	k := domain.NewID()
	in := domain.CancelInput{ExpectedVersion: 1, ReasonCode: "NOT_NEEDED"}
	first, err := s.CancelOrder(ctx, p, o.ID, k, in, domain.ResultMeta{})
	if err != nil {
		t.Fatal(err)
	}
	g.canCancel = false
	again, err := s.CancelOrder(ctx, p, o.ID, k, in, domain.ResultMeta{})
	if err != nil || again.Order.Version != first.Order.Version || len(m.out) != 1 {
		t.Fatalf("signed visit lost successful replay: %v", err)
	}
	if _, err = s.CancelOrder(ctx, p, o.ID, domain.NewID(), in, domain.ResultMeta{}); domain.Code(err) != "STATE_CONFLICT" {
		t.Fatalf("new cancellation ignored signed visit: %v", err)
	}
	g.revoked = true
	if _, err = s.CancelOrder(ctx, p, o.ID, k, in, domain.ResultMeta{}); domain.Code(err) != "NOT_FOUND" {
		t.Fatalf("revoked grant exposed replay: %v", err)
	}
}
