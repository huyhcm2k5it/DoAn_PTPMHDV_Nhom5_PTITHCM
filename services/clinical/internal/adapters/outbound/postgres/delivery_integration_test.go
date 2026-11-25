//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

func retryFromOutbox(t *testing.T, db *Probe, id string) ports.Incoming {
	t.Helper()
	var raw []byte
	if err := db.pool.QueryRow(context.Background(), `SELECT envelope FROM outbox WHERE aggregate_id=$1
        AND destination='umc.retry.clinical.v1' ORDER BY created_at DESC LIMIT 1`, id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var retry ports.BrokerRetry
	if err := json.Unmarshal(raw, &retry); err != nil {
		t.Fatal(err)
	}
	if retry.Service != "clinical" || retry.SchemaVersion != 1 || retry.NotBefore.Before(time.Now().Add(-time.Second)) {
		t.Fatal(retry)
	}
	return retry.Input
}

func TestDurableDeliveryState(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if _, err := db.pool.Exec(ctx, `TRUNCATE outbox,inbox`); err != nil {
		t.Fatal(err)
	}
	message := domain.Envelope{MessageID: domain.NewID(), AggregateID: domain.NewID()}
	if err := db.Within(ctx, "", func(tx ports.ClinicalTx) error { return tx.AppendCommand(ctx, message) }); err != nil {
		t.Fatal(err)
	}
	sent, err := db.PublishPending(ctx, func(context.Context, ports.Outgoing) error { return errors.New("mandatory return") })
	if err == nil || sent {
		t.Fatal("lost unconfirmed message", sent, err)
	}
	sent, err = db.PublishPending(ctx, func(_ context.Context, out ports.Outgoing) error {
		if out.MessageID != message.MessageID {
			t.Fatal(out)
		}
		return nil
	})
	if !sent || err != nil {
		t.Fatal(sent, err)
	}
	sent, err = db.PublishPending(ctx, func(context.Context, ports.Outgoing) error { t.Fatal("republished SENT message"); return nil })
	if sent || err != nil {
		t.Fatal(sent, err)
	}
	raw, _ := json.Marshal(domain.Envelope{MessageID: domain.NewID(), MessageType: "IdentityAccessChanged"})
	d := ports.Incoming{MessageID: domain.NewID(), Exchange: "umc.events.identity.v1", RoutingKey: "identity.identity-access-changed.v1", Body: raw}
	if err = db.ScheduleRetry(ctx, d, 1, 5*time.Second); err != nil {
		t.Fatal(err)
	}
	first := retryFromOutbox(t, db, d.MessageID)
	if !domain.ValidID(first.RetryToken) || first.Attempt != 1 {
		t.Fatal(first)
	}
	if err = db.ScheduleRetry(ctx, d, 1, 5*time.Second); err != nil {
		t.Fatal(err)
	}
	var count int
	db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE destination='umc.retry.clinical.v1'`).Scan(&count)
	if count != 1 {
		t.Fatal("original redelivery scheduled twice", count)
	}
	if err = db.ScheduleRetry(ctx, first, 2, 15*time.Second); err != nil {
		t.Fatal(err)
	}
	second := retryFromOutbox(t, db, d.MessageID)
	if second.Attempt != 2 || second.RetryToken == first.RetryToken {
		t.Fatal(second)
	}
	if err = db.Within(ctx, "", func(tx ports.ClinicalTx) error {
		old, e := tx.SeenMessage(ctx, d.MessageID, incomingHash(d), first.RetryToken)
		if e != nil || !old {
			t.Fatal("old retry remained executable", old, e)
		}
		current, e := tx.SeenMessage(ctx, d.MessageID, incomingHash(d), second.RetryToken)
		if e != nil || current {
			t.Fatal("current retry was lost", current, e)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err = db.Quarantine(ctx, second, "RETRY_EXHAUSTED"); err != nil {
		t.Fatal(err)
	}
	if err = db.Quarantine(ctx, second, "RETRY_EXHAUSTED"); err != nil {
		t.Fatal(err)
	}
	db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE destination='umc.deadletters.clinical.v1'`).Scan(&count)
	if count != 1 {
		t.Fatal("DLQ handoff not idempotent", count)
	}
}

func TestOriginalRedeliveryAcknowledgesScheduledRetryWithoutRunningHandler(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	receiver := usecase.NewReceiver(usecase.New(db, time.Now), db)
	id := domain.NewID()
	event := domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "IdentityAccessChanged", SchemaVersion: 1,
		Producer: "identity", AggregateID: id, AggregateVersion: 1, CorrelationID: domain.NewID(), CausationID: domain.NewID(), RequestID: domain.NewID(), OccurredAt: time.Now().UTC()}
	event.Payload, _ = json.Marshal(map[string]any{"userId": id, "actorType": "DOCTOR", "status": "ACTIVE", "tokenVersion": 1, "version": 1, "capabilities": []string{}, "phoneVerified": true, "phone": "0900000917"})
	body, _ := json.Marshal(event)
	d := ports.Incoming{MessageID: event.MessageID, Exchange: "umc.events.identity.v1", RoutingKey: "identity.identity-access-changed.v1", Body: body}
	if err := db.ScheduleRetry(ctx, d, 1, 5*time.Second); err != nil {
		t.Fatal(err)
	}
	if err := receiver.Receive(ctx, d); err != nil {
		t.Fatal(err)
	}
	var count int
	db.pool.QueryRow(ctx, `SELECT count(*) FROM user_access_projection WHERE user_id=$1`, id).Scan(&count)
	if count != 0 {
		t.Fatal("original delivery bypassed broker backoff")
	}
	retry := retryFromOutbox(t, db, d.MessageID)
	if err := receiver.Receive(ctx, retry); err != nil {
		t.Fatal(err)
	}
	if err := receiver.Receive(ctx, retry); err != nil {
		t.Fatal(err)
	}
	db.pool.QueryRow(ctx, `SELECT count(*) FROM user_access_projection WHERE user_id=$1`, id).Scan(&count)
	if count != 1 {
		t.Fatal("broker retry failed or duplicated projection", count)
	}
}

func TestGrantPublisherOrderingAndConcurrentWorker(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if _, err := db.pool.Exec(ctx, `TRUNCATE outbox`); err != nil {
		t.Fatal(err)
	}
	first := "00000000-0000-4000-8000-000000000002"
	second := "00000000-0000-4000-8000-000000000001"
	for i, id := range []string{first, second} {
		raw, _ := json.Marshal(map[string]any{"payload": map[string]any{"sequence": i + 1}})
		if _, err := db.pool.Exec(ctx, `INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope,created_at) VALUES($1,$1,'umc.events.clinical.v1',$2,$3,'2000-01-01')`, id, grantRoute, raw); err != nil {
			t.Fatal(err)
		}
	}
	sent, err := db.PublishPending(ctx, func(_ context.Context, out ports.Outgoing) error {
		if out.MessageID != first {
			t.Fatalf("grant sequence reordered: first=%s", out.MessageID)
		}
		next, nestedErr := db.PublishPending(ctx, func(context.Context, ports.Outgoing) error {
			t.Fatal("concurrent publisher overtook pending predecessor")
			return nil
		})
		if next || nestedErr != nil {
			t.Fatalf("concurrent worker result=%v err=%v", next, nestedErr)
		}
		return nil
	})
	if !sent || err != nil {
		t.Fatal(sent, err)
	}
	sent, err = db.PublishPending(ctx, func(_ context.Context, out ports.Outgoing) error {
		if out.MessageID != second {
			t.Fatal(out.MessageID)
		}
		return nil
	})
	if !sent || err != nil {
		t.Fatal(sent, err)
	}
}
