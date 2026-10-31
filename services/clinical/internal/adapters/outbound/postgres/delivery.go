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
	var m ports.Outgoing
	e = tx.QueryRow(ctx, `SELECT message_id::text,destination,routing_key,envelope FROM outbox WHERE status='PENDING' ORDER BY created_at,message_id LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&m.MessageID, &m.Exchange, &m.RoutingKey, &m.Body)
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
func (p *Probe) ScheduleRetry(ctx context.Context, d ports.Incoming, next int, delay time.Duration) error {
	if !domain.ValidID(d.MessageID) || next < 1 || next > 3 {
		return domain.Fail("INVALID_MESSAGE", "Invalid retry identity or attempt")
	}
	hash := incomingHash(d)
	return p.Within(ctx, "message:"+d.MessageID, func(raw ports.ClinicalTx) error {
		t := raw.(clinicalTx)
		seen, e := t.SeenMessage(ctx, d.MessageID, hash, d.LeaseID)
		if e != nil || seen {
			return e
		}
		_, e = t.tx.Exec(ctx, `INSERT INTO inbox(message_id,payload_hash,status)VALUES($1,$2,'RETRY_SCHEDULED') ON CONFLICT(message_id)DO NOTHING`, d.MessageID, hash)
		if e != nil {
			return e
		}
		_, e = t.tx.Exec(ctx, `INSERT INTO retry_jobs(message_id,exchange_name,routing_key,body,payload_hash,attempt,due_at)VALUES($1,$2,$3,$4,$5,$6,now()+$7::double precision*interval '1 second') ON CONFLICT(message_id)DO UPDATE SET attempt=EXCLUDED.attempt,due_at=EXCLUDED.due_at,lease_id=NULL,lease_until=NULL WHERE retry_jobs.payload_hash=EXCLUDED.payload_hash AND retry_jobs.status='PENDING' AND retry_jobs.attempt<EXCLUDED.attempt`, d.MessageID, d.Exchange, d.RoutingKey, d.Body, hash, next, delay.Seconds())
		return e
	})
}
func (p *Probe) Quarantine(ctx context.Context, d ports.Incoming, reason string) error {
	rawHash := domain.Hash(d.Body)
	canonicalHash := incomingHash(d)
	id := d.MessageID
	if len(id) > 128 {
		id = id[:128]
	}
	if id == "" {
		id = rawHash
	}
	return p.Within(ctx, "dead:"+id+":"+rawHash, func(raw ports.ClinicalTx) error {
		t := raw.(clinicalTx)
		deadID := domain.NewID()
		body := d.Body
		if len(body) > 1<<20 {
			body = body[:1<<20]
		}
		tag, e := t.tx.Exec(ctx, `INSERT INTO dead_letters(id,message_id,exchange_name,routing_key,body,payload_hash,reason_code)VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(message_id,payload_hash)DO NOTHING`, deadID, id, d.Exchange, d.RoutingKey, body, rawHash, reason)
		if e != nil {
			return e
		}
		if tag.RowsAffected() > 0 {
			payload, e := json.Marshal(map[string]any{"deadLetterId": deadID, "originalMessageId": id, "exchange": d.Exchange, "routingKey": d.RoutingKey, "reasonCode": reason, "payloadHash": rawHash, "body": body})
			if e != nil {
				return e
			}
			if _, e = t.tx.Exec(ctx, `INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope)VALUES($1,$2,'umc.deadletters.clinical.v1','clinical.quarantine.v1',$3)`, domain.NewID(), deadID, payload); e != nil {
				return e
			}
		}
		if domain.ValidID(id) {
			if _, e = t.tx.Exec(ctx, `UPDATE retry_jobs SET status='DEAD',lease_id=NULL,lease_until=NULL WHERE message_id=$1 AND payload_hash=$2;`, id, canonicalHash); e != nil {
				return e
			}
			_, e = t.tx.Exec(ctx, `UPDATE inbox SET status='DEAD' WHERE message_id=$1 AND payload_hash=$2 AND status='RETRY_SCHEDULED'`, id, canonicalHash)
		}
		return e
	})
}
func (p *Probe) DueRetries(ctx context.Context, limit int) ([]ports.Incoming, error) {
	if limit < 1 || limit > 20 {
		limit = 10
	}
	tx, e := p.pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	rows, e := tx.Query(ctx, `SELECT message_id::text,exchange_name,routing_key,body,attempt FROM retry_jobs WHERE status='PENDING' AND due_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY due_at LIMIT $1 FOR UPDATE SKIP LOCKED`, limit)
	if e != nil {
		return nil, e
	}
	jobs := []ports.Incoming{}
	for rows.Next() {
		var d ports.Incoming
		if e = rows.Scan(&d.MessageID, &d.Exchange, &d.RoutingKey, &d.Body, &d.Attempt); e != nil {
			rows.Close()
			return nil, e
		}
		d.LeaseID = domain.NewID()
		jobs = append(jobs, d)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	for _, d := range jobs {
		if _, e = tx.Exec(ctx, `UPDATE retry_jobs SET lease_id=$2,lease_until=now()+interval '60 seconds' WHERE message_id=$1`, d.MessageID, d.LeaseID); e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return jobs, nil
}
func (p *Probe) CompleteRetry(ctx context.Context, d ports.Incoming) error {
	_, e := p.pool.Exec(ctx, `UPDATE retry_jobs SET status='PROCESSED',lease_id=NULL,lease_until=NULL WHERE message_id=$1 AND lease_id=$2`, d.MessageID, d.LeaseID)
	return e
}
