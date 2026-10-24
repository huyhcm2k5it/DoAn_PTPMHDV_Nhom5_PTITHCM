package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"strings"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
)

type priceTx struct {
	tx    pgx.Tx
	actor string
}

func (s *Store) Within(ctx context.Context, actor, key string, f func(ports.PriceTx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// All callers acquire idempotency then item locks in the same order.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "CA-004:"+strings.ToLower(actor)+":"+strings.ToLower(key)); err != nil {
		return err
	}
	if err = f(&priceTx{tx: tx, actor: actor}); err != nil {
		return priceError(err)
	}
	return priceError(tx.Commit(ctx))
}
func priceError(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23P01" {
		return domain.Fail("OVERLAPPING_PRICE_PERIOD", "Price effective periods overlap")
	}
	return err
}
func (p *priceTx) Replay(ctx context.Context, actor, key string) (domain.PriceResult, string, bool, error) {
	var r domain.PriceResult
	var hash string
	var raw []byte
	err := p.tx.QueryRow(ctx, "SELECT request_hash,response FROM idempotency_records WHERE user_id=$1 AND operation='CA-004' AND idempotency_key=$2", actor, key).Scan(&hash, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, "", false, nil
	}
	if err != nil {
		return r, "", false, err
	}
	err = json.Unmarshal(raw, &r)
	return r, hash, true, err
}
func (p *priceTx) LockItem(ctx context.Context, typ, id string) (bool, error) {
	table := map[string]string{"EXAM": "medical_services", "LAB": "lab_tests", "MEDICINE": "medicines"}[typ]
	if table == "" {
		return false, domain.Fail("VALIDATION_ERROR", "Invalid item type")
	}
	var actual string
	err := p.tx.QueryRow(ctx, fmt.Sprintf("SELECT id::text FROM %s WHERE id=$1 AND status='ACTIVE' FOR UPDATE", table), id).Scan(&actual)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
func (p *priceTx) Overlap(ctx context.Context, input domain.PriceInput) (bool, error) {
	var overlap bool
	err := p.tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM price_versions WHERE item_type=$1 AND item_id=$2 AND tstzrange(effective_from,effective_to,'[)') && tstzrange($3::timestamptz,$4::timestamptz,'[)'))`, input.ItemType, input.ItemID, input.EffectiveFrom, input.EffectiveTo).Scan(&overlap)
	return overlap, err
}
func (p *priceTx) NextRevision(ctx context.Context, typ, id string) (int, error) {
	var revision int
	err := p.tx.QueryRow(ctx, "SELECT COALESCE(max(revision),0)+1 FROM price_versions WHERE item_type=$1 AND item_id=$2", typ, id).Scan(&revision)
	return revision, err
}
func (p *priceTx) InsertPrice(ctx context.Context, price domain.Price) error {
	_, err := p.tx.Exec(ctx, "INSERT INTO price_versions(id,item_type,item_id,revision,amount_vnd,effective_from,effective_to,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", price.PriceVersionID, price.ItemType, price.ItemID, price.Revision, price.AmountVND, price.EffectiveFrom, price.EffectiveTo, p.actor)
	return err
}
func (p *priceTx) SaveReplay(ctx context.Context, actor, key, hash string, result domain.PriceResult) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = p.tx.Exec(ctx, "INSERT INTO idempotency_records(user_id,operation,idempotency_key,request_hash,response) VALUES($1,'CA-004',$2,$3,$4)", actor, key, hash, raw)
	return err
}
func (p *priceTx) NextSequence(ctx context.Context) (int64, error) {
	var seq int64
	err := p.tx.QueryRow(ctx, "UPDATE catalog_stream SET sequence=sequence+1,generation=generation+1 WHERE singleton=true RETURNING sequence").Scan(&seq)
	return seq, err
}
func (p *priceTx) AppendChanged(ctx context.Context, e ports.Changed) error {
	payload := map[string]any{"messageId": e.MessageID, "messageKind": "EVENT", "messageType": "CatalogChanged", "schemaVersion": 1, "producer": "Catalog", "aggregateId": e.Price.ItemID, "aggregateVersion": e.Price.Revision, "correlationId": e.CorrelationID, "requestId": e.RequestID, "occurredAt": e.OccurredAt, "payload": map[string]any{"entityType": "PRICE_VERSION", "entityId": e.Price.PriceVersionID, "entityVersion": e.Price.Revision, "fullSnapshot": e.Price, "effectiveAt": e.Price.EffectiveFrom, "streamSequence": e.Sequence, "mode": "UPSERT"}}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(raw)
	_, err = p.tx.Exec(ctx, `INSERT INTO outbox(message_id,aggregate_id,aggregate_version,message_kind,message_type,producer,destination,routing_key,payload,payload_hash) VALUES($1,$2,$3,'EVENT','CatalogChanged','Catalog','umc.events.catalog.v1','catalog.catalog-changed.v1',$4,$5)`, e.MessageID, e.Price.ItemID, e.Price.Revision, raw, hex.EncodeToString(hash[:]))
	return err
}
