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

func TestDurableDeliveryState(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	_, e := db.pool.Exec(ctx, `TRUNCATE outbox,inbox,retry_jobs,dead_letters`)
	if e != nil {
		t.Fatal(e)
	}
	message := domain.Envelope{MessageID: domain.NewID(), AggregateID: domain.NewID()}
	e = db.Within(ctx, "", func(tx ports.ClinicalTx) error { return tx.AppendCommand(ctx, message) })
	if e != nil {
		t.Fatal(e)
	}
	sent, e := db.PublishPending(ctx, func(context.Context, ports.Outgoing) error { return errors.New("mandatory return") })
	if e == nil || sent {
		t.Fatal("lost unconfirmed message", sent, e)
	}
	var count int
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE status='PENDING'`).Scan(&count)
	if count != 1 {
		t.Fatal(count)
	}
	sent, e = db.PublishPending(ctx, func(_ context.Context, out ports.Outgoing) error {
		if out.MessageID != message.MessageID || out.Exchange != "umc.commands.clinical.v1" {
			t.Fatal(out)
		}
		return nil
	})
	if e != nil || !sent {
		t.Fatal(sent, e)
	}
	sent, e = db.PublishPending(ctx, func(context.Context, ports.Outgoing) error { t.Fatal("republished SENT message"); return nil })
	if e != nil || sent {
		t.Fatal(sent, e)
	}
	event := domain.Envelope{MessageID: domain.NewID(), MessageType: "IdentityAccessChanged"}
	raw, _ := json.Marshal(event)
	d := ports.Incoming{MessageID: event.MessageID, Exchange: "umc.events.identity.v1", RoutingKey: "identity.identity-access-changed.v1", Body: raw}
	if e = db.ScheduleRetry(ctx, d, 1, 5*time.Second); e != nil {
		t.Fatal(e)
	}
	var status string
	_ = db.pool.QueryRow(ctx, `SELECT status FROM inbox WHERE message_id=$1`, d.MessageID).Scan(&status)
	if status != "RETRY_SCHEDULED" {
		t.Fatal(status)
	}
	_, _ = db.pool.Exec(ctx, `UPDATE retry_jobs SET due_at=now()-interval '1 second'`)
	jobs, e := db.DueRetries(ctx, 10)
	if e != nil || len(jobs) != 1 || jobs[0].Attempt != 1 || !domain.ValidID(jobs[0].LeaseID) {
		t.Fatal(jobs, e)
	}
	others, e := db.DueRetries(ctx, 10)
	if e != nil || len(others) != 0 {
		t.Fatal("duplicate retry lease", others, e)
	}
	if e = db.ScheduleRetry(ctx, jobs[0], 2, 15*time.Second); e != nil {
		t.Fatal(e)
	}
	if e = db.CompleteRetry(ctx, jobs[0]); e != nil {
		t.Fatal(e)
	}
	var attempt int
	_ = db.pool.QueryRow(ctx, `SELECT status,attempt FROM retry_jobs WHERE message_id=$1`, d.MessageID).Scan(&status, &attempt)
	if status != "PENDING" || attempt != 2 {
		t.Fatal("old lease completed newer retry", status, attempt)
	}
	if e = db.Quarantine(ctx, d, "RETRY_EXHAUSTED"); e != nil {
		t.Fatal(e)
	}
	if e = db.Quarantine(ctx, d, "RETRY_EXHAUSTED"); e != nil {
		t.Fatal(e)
	}
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM dead_letters`).Scan(&count)
	if count != 1 {
		t.Fatal("quarantine not idempotent", count)
	}
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE destination='umc.deadletters.clinical.v1'`).Scan(&count)
	if count != 1 {
		t.Fatal("deadletter not in transactional outbox", count)
	}
}

func TestOriginalRedeliveryAcknowledgesScheduledRetryWithoutRunningHandler(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	app := usecase.New(db, time.Now)
	receiver := usecase.NewReceiver(app, db)
	id := domain.NewID()
	event := domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "IdentityAccessChanged", SchemaVersion: 1, Producer: "identity", AggregateID: id, AggregateVersion: 1, CorrelationID: domain.NewID(), CausationID: domain.NewID(), RequestID: domain.NewID(), OccurredAt: time.Now().UTC()}
	event.Payload, _ = json.Marshal(map[string]any{"userId": id, "actorType": "DOCTOR", "status": "ACTIVE", "tokenVersion": 1, "version": 1, "capabilities": []string{}, "phoneVerified": true})
	body, _ := json.Marshal(event)
	d := ports.Incoming{MessageID: event.MessageID, Exchange: "umc.events.identity.v1", RoutingKey: "identity.identity-access-changed.v1", Body: body}
	if err := db.ScheduleRetry(ctx, d, 1, 5*time.Second); err != nil {
		t.Fatal(err)
	}
	if err := receiver.Receive(ctx, d); err != nil {
		t.Fatal(err)
	}
	var count int
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM user_access_projection WHERE user_id=$1`, id).Scan(&count)
	if count != 0 {
		t.Fatal("original redelivery bypassed scheduled backoff")
	}
	_, _ = db.pool.Exec(ctx, `UPDATE retry_jobs SET due_at=now()-interval '1 second' WHERE message_id=$1`, d.MessageID)
	jobs, err := db.DueRetries(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	var job *ports.Incoming
	for i := range jobs {
		if jobs[i].MessageID == d.MessageID {
			job = &jobs[i]
		}
	}
	if job == nil {
		t.Fatal("scheduled job missing")
	}
	if err = receiver.Receive(ctx, *job); err != nil {
		t.Fatal(err)
	}
	if err = db.CompleteRetry(ctx, *job); err != nil {
		t.Fatal(err)
	}
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM user_access_projection WHERE user_id=$1`, id).Scan(&count)
	if count != 1 {
		t.Fatal("leased retry did not apply projection")
	}
}
