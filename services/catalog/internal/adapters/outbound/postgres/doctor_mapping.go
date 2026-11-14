package postgres

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"strings"
	"time"
	"umccare/catalog/internal/domain"
)

type DoctorMappingChange struct{ DoctorID, ExpectedIdentityUserID, IdentityUserID, Operator, Reason string }
type DoctorMappingResult struct {
	DoctorID       string `json:"doctorId"`
	IdentityUserID string `json:"identityUserId"`
	Revision       int    `json:"revision"`
	Sequence       int64  `json:"sequence"`
	MessageID      string `json:"messageId"`
}

func (s *Store) RebindDoctor(ctx context.Context, change DoctorMappingChange) (DoctorMappingResult, error) {
	var result DoctorMappingResult
	if !domain.ValidID(change.DoctorID) || !domain.ValidID(change.ExpectedIdentityUserID) || !domain.ValidID(change.IdentityUserID) || strings.TrimSpace(change.Operator) == "" || len(change.Operator) > 128 || strings.TrimSpace(change.Reason) == "" || len(change.Reason) > 500 {
		return result, domain.Fail("VALIDATION_ERROR", "Valid doctor, old/new Identity IDs, operator and reason required")
	}
	change.DoctorID = strings.ToLower(change.DoctorID)
	change.ExpectedIdentityUserID = strings.ToLower(change.ExpectedIdentityUserID)
	change.IdentityUserID = strings.ToLower(change.IdentityUserID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	var current, department, name, status string
	var revision int
	err = tx.QueryRow(ctx, `SELECT identity_user_id::text,department_id::text,display_name,status,revision FROM doctors WHERE id=$1 FOR UPDATE`, change.DoctorID).Scan(&current, &department, &name, &status, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, domain.Fail("NOT_FOUND", "Doctor not found")
	}
	if err != nil {
		return result, err
	}
	var actor, accessStatus string
	err = tx.QueryRow(ctx, `SELECT actor_type,status FROM user_access_projection WHERE user_id=$1 FOR SHARE`, change.IdentityUserID).Scan(&actor, &accessStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, domain.Fail("SERVICE_UNAVAILABLE", "Target Identity projection missing")
	}
	if err != nil {
		return result, err
	}
	if actor != "DOCTOR" || accessStatus != "ACTIVE" {
		return result, domain.Fail("STATE_CONFLICT", "Target account must be an active Identity DOCTOR")
	}
	result = DoctorMappingResult{DoctorID: change.DoctorID, IdentityUserID: change.IdentityUserID, Revision: revision}
	if current == change.IdentityUserID {
		err = tx.QueryRow(ctx, `SELECT message_id::text,stream_sequence FROM doctor_mapping_audit WHERE doctor_id=$1 AND revision=$2 AND previous_identity_user_id=$3 AND identity_user_id=$4 AND operator_name=$5 AND reason=$6`, change.DoctorID, revision, change.ExpectedIdentityUserID, change.IdentityUserID, change.Operator, change.Reason).Scan(&result.MessageID, &result.Sequence)
		if errors.Is(err, pgx.ErrNoRows) {
			return result, domain.Fail("STATE_CONFLICT", "Mapping does not match a previous identical repair")
		}
		if err != nil {
			return result, err
		}
		return result, tx.Commit(ctx)
	}
	if current != change.ExpectedIdentityUserID {
		return result, domain.Fail("STATE_CONFLICT", "Doctor mapping changed; review before retrying")
	}
	if _, err = tx.Exec(ctx, `UPDATE doctors SET identity_user_id=$2,revision=revision+1 WHERE id=$1`, change.DoctorID, change.IdentityUserID); err != nil {
		return result, err
	}
	result.Revision++
	if err = tx.QueryRow(ctx, `UPDATE catalog_stream SET sequence=sequence+1 WHERE singleton RETURNING sequence`).Scan(&result.Sequence); err != nil {
		return result, err
	}
	now := time.Now().UTC()
	mode := "UPSERT"
	if status == "INACTIVE" {
		mode = "TOMBSTONE"
	}
	snapshot := map[string]any{"id": change.DoctorID, "identityUserId": change.IdentityUserID, "departmentId": department, "displayName": name, "status": status}
	raw, err := buildCatalogEntityEnvelope(catalogStreamEntity{EntityType: "DOCTOR", EntityID: change.DoctorID, AggregateID: change.DoctorID, Version: result.Revision, Snapshot: snapshot, EffectiveAt: now, Mode: mode}, result.Sequence)
	if err != nil {
		return result, err
	}
	if err = insertCatalogOutbox(ctx, tx, change.DoctorID, result.Revision, raw); err != nil {
		return result, err
	}
	if err = tx.QueryRow(ctx, `SELECT message_id::text FROM outbox WHERE aggregate_id=$1 AND aggregate_version=$2 AND payload->'payload'->>'entityType'='DOCTOR'`, change.DoctorID, result.Revision).Scan(&result.MessageID); err != nil {
		return result, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO doctor_mapping_audit(message_id,doctor_id,previous_identity_user_id,identity_user_id,revision,stream_sequence,operator_name,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, result.MessageID, change.DoctorID, current, change.IdentityUserID, result.Revision, result.Sequence, change.Operator, change.Reason)
	if err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}
