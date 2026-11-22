package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"umccare/diagnostic/internal/domain"
)

func replayIdentity(key string) (actor, operation, id string, err error) {
	parts := strings.Split(key, ":")
	if len(parts) != 3 || !domain.ValidID(parts[0]) || parts[1] == "" || !domain.ValidID(parts[2]) {
		return "", "", "", domain.Fail("VALIDATION_ERROR", "Invalid idempotency identity")
	}
	return domain.ID(parts[0]), parts[1], domain.ID(parts[2]), nil
}

func (t diagnosticTx) getReplay(ctx context.Context, key string) (json.RawMessage, error) {
	actor, operation, id, err := replayIdentity(key)
	if err != nil {
		return nil, err
	}
	var raw []byte
	err = t.tx.QueryRow(ctx, `SELECT jsonb_build_object('hash',request_hash,'response',response)
        FROM idempotency_records WHERE actor_id=$1 AND operation=$2 AND idempotency_key=$3 FOR UPDATE`, actor, operation, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.Fail("NOT_FOUND", "Record not found")
	}
	return raw, err
}

func (t diagnosticTx) putReplay(ctx context.Context, key string, raw []byte) error {
	actor, operation, id, err := replayIdentity(key)
	if err != nil {
		return err
	}
	var entry struct {
		Hash     string          `json:"hash"`
		Response json.RawMessage `json:"response"`
	}
	if json.Unmarshal(raw, &entry) != nil || entry.Hash == "" || !json.Valid(entry.Response) {
		return domain.Fail("VALIDATION_ERROR", "Invalid idempotency result")
	}
	tag, err := t.tx.Exec(ctx, `INSERT INTO idempotency_records(actor_id,operation,idempotency_key,request_hash,response)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(actor_id,operation,idempotency_key) DO UPDATE SET response=idempotency_records.response
        WHERE idempotency_records.request_hash=EXCLUDED.request_hash AND idempotency_records.response=EXCLUDED.response`, actor, operation, id, entry.Hash, entry.Response)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return domain.Fail("IDEMPOTENCY_CONFLICT", "Idempotency result cannot change")
	}
	return nil
}
