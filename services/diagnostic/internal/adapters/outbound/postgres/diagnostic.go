package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
	"umccare/diagnostic/migrations"
)

type diagnosticTx struct{ tx pgx.Tx }

func (p *Probe) Migrate(ctx context.Context) error {
	tx, e := p.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('diagnostic:migrate',0));CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY)`); e != nil {
		return e
	}
	var exists bool
	if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version='000001_diagnostic')`).Scan(&exists); e != nil {
		return e
	}
	if !exists {
		b, readErr := migrations.Files.ReadFile("000001_diagnostic.up.sql")
		if readErr != nil {
			return readErr
		}
		if _, e = tx.Exec(ctx, string(b)); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `INSERT INTO schema_migrations VALUES('000001_diagnostic')`); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
func (p *Probe) BusinessReady(ctx context.Context) error {
	var b bool
	e := p.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version='000001_diagnostic')`).Scan(&b)
	if e != nil || !b {
		return domain.Fail("SERVICE_UNAVAILABLE", "Diagnostic migrations required")
	}
	return nil
}
func (p *Probe) Within(ctx context.Context, lock string, fn func(ports.Tx) error) error {
	tx, e := p.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if lock != "" {
		if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, lock); e != nil {
			return e
		}
	}
	if e = fn(diagnosticTx{tx}); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (t diagnosticTx) Get(ctx context.Context, kind, key string) (json.RawMessage, error) {
	var b []byte
	e := t.tx.QueryRow(ctx, `SELECT value FROM objects WHERE kind=$1 AND key=$2 FOR UPDATE`, kind, key).Scan(&b)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, domain.Fail("NOT_FOUND", "Record not found")
	}
	return b, e
}
func (t diagnosticTx) Put(ctx context.Context, kind, key string, v any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	_, e = t.tx.Exec(ctx, `INSERT INTO objects(kind,key,value)VALUES($1,$2,$3)ON CONFLICT(kind,key)DO UPDATE SET value=EXCLUDED.value`, kind, key, b)
	return e
}
func (t diagnosticTx) Orders(ctx context.Context) ([]domain.Order, error) {
	rows, e := t.tx.Query(ctx, `SELECT body FROM lab_orders ORDER BY id FOR UPDATE`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []domain.Order{}
	for rows.Next() {
		var b []byte
		var s domain.Stored
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &s); e != nil {
			return nil, e
		}
		items = append(items, s.Value())
	}
	return items, rows.Err()
}
func (t diagnosticTx) SaveOrder(ctx context.Context, o domain.Order) error {
	b, e := json.Marshal(o.Stored())
	if e != nil {
		return e
	}
	_, e = t.tx.Exec(ctx, `INSERT INTO lab_orders(id,clinical_request_id,body)VALUES($1,$2,$3)ON CONFLICT(id)DO UPDATE SET body=EXCLUDED.body`, o.ID, o.RequestID, b)
	if e != nil {
		return e
	}
	for _, s := range o.Specimens {
		var prior string
		e = t.tx.QueryRow(ctx, `INSERT INTO specimen_barcodes(barcode,order_id)VALUES($1,$2)ON CONFLICT(barcode)DO UPDATE SET barcode=EXCLUDED.barcode RETURNING order_id::text`, s.Barcode, o.ID).Scan(&prior)
		if e != nil {
			return e
		}
		if prior != o.ID {
			return domain.Fail("STATE_CONFLICT", "Barcode already in use")
		}
	}
	return nil
}
func (t diagnosticTx) Outbox(ctx context.Context, m domain.Envelope, exchange, key string) error {
	b, e := json.Marshal(m)
	if e != nil {
		return e
	}
	_, e = t.tx.Exec(ctx, `INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope)VALUES($1,$2,$3,$4,$5)`, m.MessageID, m.AggregateID, exchange, key, b)
	return e
}
func (t diagnosticTx) SeenMessage(ctx context.Context, id, hash, leaseID string) (seen bool, e error) {
	if _, e = t.tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "message:"+id); e != nil {
		return
	}
	var prior, status string
	e = t.tx.QueryRow(ctx, `SELECT payload_hash,status FROM inbox WHERE message_id=$1`, id).Scan(&prior, &status)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return
	}
	if prior != hash {
		return false, domain.Fail("INVALID_MESSAGE", "Message ID reused with different content")
	}
	if status != "RETRY_SCHEDULED" || leaseID == "" {
		return true, nil
	}
	var leased bool
	e = t.tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM retry_jobs WHERE message_id=$1 AND lease_id=$2 AND lease_until>now() AND status='PENDING')`, id, leaseID).Scan(&leased)
	if e != nil {
		return false, e
	}
	if !leased {
		return false, domain.Fail("INVALID_MESSAGE", "Scheduled retry requires its current database lease")
	}
	return false, nil
}
func (t diagnosticTx) MarkMessage(ctx context.Context, id, hash string) error {
	_, e := t.tx.Exec(ctx, `INSERT INTO inbox(message_id,payload_hash)VALUES($1,$2) ON CONFLICT(message_id)DO UPDATE SET status='PROCESSED',processed_at=now() WHERE inbox.payload_hash=EXCLUDED.payload_hash`, id, hash)
	return e
}
