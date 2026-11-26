package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"time"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

// A row remains PENDING until a mandatory broker publish is confirmed and this
// transaction commits. Crash after confirm may duplicate; consumers deduplicate.
func (p *Probe) PublishPending(ctx context.Context, publish func(context.Context, ports.Outgoing) error) (bool, error) {
	tx, e := p.pool.Begin(ctx)
	if e != nil {
		return false, e
	}
	defer tx.Rollback(ctx)
	var publisherLock bool
	if e = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(7210432)`).Scan(&publisherLock); e != nil || !publisherLock {
		return false, e
	}
	var m ports.Outgoing
	e = tx.QueryRow(ctx, `SELECT message_id::text,destination,routing_key,envelope FROM outbox WHERE status='PENDING' ORDER BY CASE WHEN routing_key='clinical.visit-doctor-grant-changed.v1' THEN (envelope->'payload'->>'sequence')::bigint ELSE 0 END,CASE WHEN routing_key='clinical.visit-doctor-grant-changed.v1' AND envelope->'payload'->>'mode'='CHECKPOINT' THEN 1 ELSE 0 END,created_at,message_id LIMIT 1 FOR UPDATE`).Scan(&m.MessageID, &m.Exchange, &m.RoutingKey, &m.Body)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	if e = publish(ctx, m); e != nil {
		return false, e
	}
	if _, e = tx.Exec(ctx, `UPDATE outbox SET status='SENT',sent_at=now() WHERE message_id=$1`, m.MessageID); e != nil {
		return false, e
	}
	if e = tx.Commit(ctx); e != nil {
		return false, e
	}
	return true, nil
}
func incomingHash(d ports.Incoming) string {
	var event domain.Envelope
	if json.Unmarshal(d.Body, &event) == nil {
		return domain.Hash(event)
	}
	return domain.Hash(d.Body)
}

// ScheduleRetry commits an outbox handoff before the original delivery is ACKed.
// Only the current token may advance an attempt; duplicate broker deliveries are harmless.
func (p *Probe) ScheduleRetry(ctx context.Context, d ports.Incoming, next int, delay time.Duration) error {
	if !domain.ValidID(d.MessageID) || next != d.Attempt+1 || next < 1 || next > 3 || delay < 0 || delay > 61*time.Second {
		return domain.Fail("INVALID_MESSAGE", "Invalid broker retry")
	}
	hash := incomingHash(d)
	return p.Within(ctx, "message:"+d.MessageID, func(base ports.ClinicalTx) error {
		t := base.(clinicalTx)
		seen, err := t.SeenMessage(ctx, d.MessageID, hash, d.RetryToken)
		if err != nil || seen {
			return err
		}
		token := domain.NewID()
		d.Attempt, d.RetryToken = next, token
		body, err := json.Marshal(ports.BrokerRetry{SchemaVersion: 1, Service: "clinical", Input: d, NotBefore: time.Now().UTC().Add(delay)})
		if err != nil {
			return err
		}
		_, err = t.tx.Exec(ctx, `INSERT INTO inbox(message_id,payload_hash,status,retry_token,delivery_attempt)
            VALUES($1,$2,'RETRY_SCHEDULED',$3,$4) ON CONFLICT(message_id) DO UPDATE
            SET status='RETRY_SCHEDULED',retry_token=EXCLUDED.retry_token,delivery_attempt=EXCLUDED.delivery_attempt`, d.MessageID, hash, token, next)
		if err != nil {
			return err
		}
		_, err = t.tx.Exec(ctx, `INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope)
            VALUES($1,$2,'umc.retry.clinical.v1','retry',$3)`, token, d.MessageID, body)
		return err
	})
}

// Quarantine uses the existing outbox to hand off the complete failure to RabbitMQ DLQ.
// No separate PostgreSQL copy of the DLQ is required.
func (p *Probe) Quarantine(ctx context.Context, d ports.Incoming, reason string) error {
	rawHash := domain.Hash(d.Body)
	id := d.MessageID
	if len(id) > 128 {
		id = id[:128]
	}
	if id == "" {
		id = rawHash
	}
	body := d.Body
	truncated := len(body) > 1<<20
	if truncated {
		body = body[:1<<20]
	}
	record, err := json.Marshal(map[string]any{"originalMessageId": id, "exchange": d.Exchange, "routingKey": d.RoutingKey,
		"reasonCode": reason, "payloadHash": rawHash, "body": body, "attempt": d.Attempt, "bodyTruncated": truncated})
	if err != nil {
		return err
	}
	return p.Within(ctx, "dead:"+id+":"+rawHash, func(base ports.ClinicalTx) error {
		t := base.(clinicalTx)
		_, err := t.tx.Exec(ctx, `INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope)
            VALUES(md5($1)::uuid,md5($1)::uuid,'umc.deadletters.clinical.v1','clinical.quarantine.v1',$2)
            ON CONFLICT(message_id) DO NOTHING`, "clinical:dead:"+id+":"+rawHash+":"+reason, record)
		if err != nil {
			return err
		}
		if domain.ValidID(d.MessageID) {
			_, err = t.tx.Exec(ctx, `INSERT INTO inbox(message_id,payload_hash,status) VALUES($1,$2,'DEAD')
                ON CONFLICT(message_id) DO UPDATE SET status='DEAD',retry_token=NULL
                WHERE inbox.payload_hash=EXCLUDED.payload_hash AND inbox.status='RETRY_SCHEDULED'
                  AND (inbox.retry_token IS NULL OR inbox.retry_token=NULLIF($3,'')::uuid)`, d.MessageID, incomingHash(d), d.RetryToken)
		}
		return err
	})
}
