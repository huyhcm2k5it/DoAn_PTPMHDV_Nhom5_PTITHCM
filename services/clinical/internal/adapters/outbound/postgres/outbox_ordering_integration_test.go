//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

func visitGrantMessage(sequence int) domain.Envelope {
	visit := domain.NewID()
	payload, _ := json.Marshal(map[string]any{
		"mode": "UPSERT", "sequence": sequence, "visitId": visit,
		"patientId": domain.NewID(), "doctorUserId": domain.NewID(),
		"active": true, "canCancel": true,
	})
	return domain.Envelope{
		MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "VisitDoctorGrantChanged",
		SchemaVersion: 1, Producer: "clinical", AggregateID: visit, AggregateVersion: sequence,
		CorrelationID: domain.NewID(), CausationID: domain.NewID(), RequestID: domain.NewID(),
		OccurredAt: time.Now().UTC(), Payload: payload,
	}
}

func appendVisitGrant(t *testing.T, db *Probe, sequence int) {
	t.Helper()
	if err := db.Within(context.Background(), "", func(tx ports.ClinicalTx) error {
		return tx.(clinicalTx).AppendMessage(context.Background(), visitGrantMessage(sequence),
			"umc.events.clinical.v1", "clinical.visit-doctor-grant-changed.v1")
	}); err != nil {
		t.Fatal(err)
	}
}

func TestVisitGrantOutboxOrdersBySequenceAcrossTransactionStartTimes(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if _, err := db.pool.Exec(ctx, "TRUNCATE outbox"); err != nil {
		t.Fatal(err)
	}
	// This transaction starts first but obtains its stream sequence later.
	early, err := db.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer early.Rollback(ctx)
	if _, err = early.Exec(ctx, "SELECT now()"); err != nil {
		t.Fatal(err)
	}
	appendVisitGrant(t, db, 1)
	if err = (clinicalTx{tx: early}).AppendMessage(ctx, visitGrantMessage(2),
		"umc.events.clinical.v1", "clinical.visit-doctor-grant-changed.v1"); err != nil {
		t.Fatal(err)
	}
	if err = early.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	for _, want := range []int{1, 2} {
		got := 0
		sent, err := db.PublishPending(ctx, func(_ context.Context, out ports.Outgoing) error {
			var event domain.Envelope
			if err := json.Unmarshal(out.Body, &event); err != nil {
				return err
			}
			got = event.AggregateVersion
			return nil
		})
		if err != nil || !sent || got != want {
			t.Fatalf("want sequence %d, got %d (sent=%v, err=%v)", want, got, sent, err)
		}
	}
}

func TestVisitGrantPublishersCannotOvertakeUnconfirmedMessage(t *testing.T) {
	db := testDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.pool.Exec(ctx, "TRUNCATE outbox"); err != nil {
		t.Fatal(err)
	}
	appendVisitGrant(t, db, 1)
	appendVisitGrant(t, db, 2)
	started, release := make(chan struct{}), make(chan struct{}, 1)
	defer close(release)
	type result struct {
		sent bool
		err  error
	}
	done := make(chan result, 1)
	unconfirmed := errors.New("broker did not confirm")
	go func() {
		sent, err := db.PublishPending(ctx, func(call context.Context, _ ports.Outgoing) error {
			close(started)
			select {
			case <-release:
				return unconfirmed
			case <-call.Done():
				return call.Err()
			}
		})
		done <- result{sent, err}
	}()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("first publisher did not reach broker")
	}
	called := false
	sent, err := db.PublishPending(ctx, func(context.Context, ports.Outgoing) error {
		called = true
		return nil
	})
	// Release the first publisher without closing the channel twice on failure.
	release <- struct{}{}
	first := <-done
	if err != nil || sent || called {
		t.Fatalf("second publisher overtook an unconfirmed message: sent=%v called=%v err=%v", sent, called, err)
	}
	if first.sent || !errors.Is(first.err, unconfirmed) {
		t.Fatalf("unconfirmed publish was lost: %+v", first)
	}
	// Rollback must release the publisher lock and leave sequence 1 pending.
	for _, want := range []int{1, 2} {
		got := 0
		sent, err = db.PublishPending(ctx, func(_ context.Context, out ports.Outgoing) error {
			var event domain.Envelope
			if err := json.Unmarshal(out.Body, &event); err != nil {
				return err
			}
			got = event.AggregateVersion
			return nil
		})
		if err != nil || !sent || got != want {
			t.Fatalf("retry: want sequence %d, got %d (sent=%v, err=%v)", want, got, sent, err)
		}
	}
}

func TestVisitGrantPublisherUsesTheSharedDeploymentLock(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if _, err := db.pool.Exec(ctx, "TRUNCATE outbox"); err != nil {
		t.Fatal(err)
	}
	appendVisitGrant(t, db, 1)
	other, err := db.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Rollback(ctx)
	// develop's other Clinical publishers coordinate with this same lock.
	if _, err = other.Exec(ctx, "SELECT pg_advisory_xact_lock(7210432)"); err != nil {
		t.Fatal(err)
	}
	called := false
	sent, err := db.PublishPending(ctx, func(context.Context, ports.Outgoing) error {
		called = true
		return nil
	})
	if err != nil || sent || called {
		t.Fatalf("publisher ignored the shared deployment lock: sent=%v called=%v err=%v", sent, called, err)
	}
}
