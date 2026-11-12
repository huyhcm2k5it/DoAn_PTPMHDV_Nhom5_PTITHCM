//go:build integration

package postgres

import (
	"context"
	"testing"
	"time"

	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/application/usecase"
	"umccare/diagnostic/internal/domain"
)

type visitGrantStore struct{ *Probe }
type visitGrantTx struct{ ports.Tx }

func (s visitGrantStore) Within(ctx context.Context, lock string, fn func(ports.Tx) error) error {
	return s.Probe.Within(ctx, lock, func(tx ports.Tx) error { return fn(visitGrantTx{tx}) })
}

func (visitGrantTx) VerifyVisitGrant(context.Context, string, string, string, bool, time.Time) error {
	return nil
}

func TestCancellationRejectsInFlightChargeBeforeDelayedChargePrepared(t *testing.T) {
	db := testDB(t)
	s, in, _ := setup(t, db)
	o := createOrder(t, db, s, in)
	ctx := context.Background()
	doctor := domain.Principal{UserID: domain.NewID(), ActorType: "DOCTOR", TokenVersion: 1, LeaseAction: "DI-012", LeaseExpiresAt: time.Now().Add(time.Minute)}
	if err := db.Within(ctx, "diagnostic:business", func(tx ports.Tx) error {
		return tx.Put(ctx, "access", doctor.UserID, domain.Access{UserID: doctor.UserID, ActorType: doctor.ActorType, Status: "ACTIVE", TokenVersion: doctor.TokenVersion})
	}); err != nil {
		t.Fatal(err)
	}
	service := usecase.New(visitGrantStore{db}, time.Now)
	cancel := domain.CancelInput{ReasonCode: "DOCTOR_REQUEST", ExpectedVersion: o.Version}
	if _, err := service.CancelOrder(ctx, doctor, o.ID, domain.NewID(), cancel, domain.ResultMeta{CorrelationID: domain.NewID()}); domain.Code(err) != "STATE_CONFLICT" {
		t.Fatalf("order with pending charge was cancelled: %v", err)
	}

	chargeID := domain.NewID()
	prepared := msg("ChargePrepared", "EVENT", "billing", o.ID, o.ChargeRequestID, map[string]any{
		"requestId": o.ChargeRequestID, "sourceType": "LAB_ORDER", "sourceId": o.ID,
		"sourceRevision": o.SourceRevision, "chargeId": chargeID, "state": "CREATED", "reasonCode": "",
	})
	if err := service.Handle(ctx, "umc.events.billing.v1", "billing.charge-prepared.v1", prepared); err != nil {
		t.Fatal(err)
	}
	var updated domain.Order
	if err := db.Within(ctx, "", func(tx ports.Tx) error {
		orders, err := tx.Orders(ctx)
		if err == nil {
			updated = orders[0]
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if updated.State != "PENDING_PAYMENT" || updated.ChargeState != "CREATED" || updated.ChargeID != chargeID {
		t.Fatalf("delayed charge event did not retain a payable order: %+v", updated)
	}
	cancel.ExpectedVersion = updated.Version
	if _, err := service.CancelOrder(ctx, doctor, o.ID, domain.NewID(), cancel, domain.ResultMeta{CorrelationID: domain.NewID()}); domain.Code(err) != "STATE_CONFLICT" {
		t.Fatalf("order with prepared charge was cancelled: %v", err)
	}
	var cancellations int
	if err := db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE envelope->>'messageType'='LabCancelled'`).Scan(&cancellations); err != nil {
		t.Fatal(err)
	}
	if cancellations != 0 {
		t.Fatalf("active charge has %d cancellation events", cancellations)
	}
}
