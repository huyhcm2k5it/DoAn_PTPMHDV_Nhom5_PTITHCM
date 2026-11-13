package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
)

// buildCatalogChangedEnvelope is shared by the transactional price writer and the bootstrap stream.
// The request ID is the causal command for user initiated Catalog writes.
func buildCatalogChangedEnvelope(e ports.Changed) ([]byte, error) {
	message := map[string]any{
		"messageId": e.MessageID, "messageKind": "EVENT", "messageType": "CatalogChanged", "schemaVersion": 1,
		"producer": "catalog", "aggregateId": e.Price.ItemID, "aggregateVersion": e.Price.Revision,
		"correlationId": e.CorrelationID, "causationId": e.RequestID, "requestId": e.RequestID, "occurredAt": e.OccurredAt,
		"payload": map[string]any{"entityType": "PRICE_VERSION", "entityId": e.Price.PriceVersionID, "entityVersion": e.Price.Revision,
			"fullSnapshot": e.Price, "effectiveAt": e.Price.EffectiveFrom, "streamSequence": e.Sequence, "mode": "UPSERT"},
	}
	return json.Marshal(message)
}

func insertCatalogOutbox(ctx context.Context, tx pgx.Tx, aggregateID string, version int, raw []byte) error {
	var envelope struct {
		MessageID   string `json:"messageId"`
		MessageType string `json:"messageType"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil || !domain.ValidID(envelope.MessageID) || envelope.MessageType != "CatalogChanged" {
		return fmt.Errorf("invalid CatalogChanged envelope")
	}
	hash := sha256.Sum256(raw)
	_, err := tx.Exec(ctx, `INSERT INTO outbox(message_id,aggregate_id,aggregate_version,message_kind,message_type,producer,destination,routing_key,payload,payload_hash) VALUES($1,$2,$3,'EVENT','CatalogChanged','catalog','umc.events.catalog.v1','catalog.catalog-changed.v1',$4,$5)`, envelope.MessageID, aggregateID, version, raw, hex.EncodeToString(hash[:]))
	return err
}

// PublishPending keeps the row locked until a broker confirm is received. A crash
// after confirm can duplicate delivery; downstream inboxes deduplicate by messageId.
func (s *Store) PublishPending(ctx context.Context, publish func(context.Context, ports.Outgoing) error) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var publisherLock bool
	if err = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(7210431)`).Scan(&publisherLock); err != nil || !publisherLock {
		return false, err
	}
	var message ports.Outgoing
	err = tx.QueryRow(ctx, `SELECT message_id::text,destination,routing_key,payload FROM outbox WHERE message_id=(SELECT message_id FROM outbox WHERE status='PENDING' ORDER BY (payload->'payload'->>'streamSequence')::bigint,CASE WHEN payload->'payload'->>'mode'='CHECKPOINT' THEN 1 ELSE 0 END,created_at,message_id LIMIT 1) AND next_attempt_at<=now() FOR UPDATE`).Scan(&message.MessageID, &message.Exchange, &message.RoutingKey, &message.Body)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err = publish(ctx, message); err != nil {
		var retries int
		if scanErr := tx.QueryRow(ctx, `SELECT retry_count FROM outbox WHERE message_id=$1`, message.MessageID).Scan(&retries); scanErr != nil {
			return false, scanErr
		}
		if retries >= 3 {
			if _, err = tx.Exec(ctx, `UPDATE outbox SET status='FAILED',retry_count=retry_count+1,last_error=$2 WHERE message_id=$1`, message.MessageID, err.Error()); err != nil {
				return false, err
			}
		} else {
			delay := []int{5, 15, 60}[retries]
			if _, err = tx.Exec(ctx, `UPDATE outbox SET retry_count=retry_count+1,next_attempt_at=now()+$2*interval '1 second',last_error=$3 WHERE message_id=$1`, message.MessageID, delay, err.Error()); err != nil {
				return false, err
			}
		}
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return false, commitErr
		}
		return false, nil
	}
	if _, err = tx.Exec(ctx, `UPDATE outbox SET status='SENT',sent_at=now(),last_error='' WHERE message_id=$1`, message.MessageID); err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

type catalogStreamEntity struct {
	EntityType, EntityID, AggregateID string
	Version                           int
	Snapshot                          any
	EffectiveAt                       time.Time
	Mode                              string
}

type SnapshotEntry struct {
	EntityType    string `json:"entityType"`
	EntityID      string `json:"entityId"`
	EntityVersion int    `json:"entityVersion"`
	Mode          string `json:"mode"`
	Snapshot      any    `json:"fullSnapshot"`
}
type CatalogSnapshot struct {
	SchemaVersion int             `json:"schemaVersion"`
	Watermark     int64           `json:"watermark"`
	GeneratedAt   time.Time       `json:"generatedAt"`
	Checksum      string          `json:"checksum"`
	Entities      []SnapshotEntry `json:"entities"`
}

// ExportCatalogSnapshot returns a consistent operator snapshot and its stream watermark.
// A repeatable-read transaction prevents mixed generations during concurrent writes.
func (s *Store) ExportCatalogSnapshot(ctx context.Context) (CatalogSnapshot, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return CatalogSnapshot{}, err
	}
	defer tx.Rollback(ctx)
	var watermark int64
	if err = tx.QueryRow(ctx, `SELECT sequence FROM catalog_stream WHERE singleton=true FOR SHARE`).Scan(&watermark); err != nil {
		return CatalogSnapshot{}, err
	}
	streamEntities, err := catalogSnapshotEntities(ctx, tx, time.Now().UTC())
	if err != nil {
		return CatalogSnapshot{}, err
	}
	entries := make([]SnapshotEntry, 0, len(streamEntities))
	for _, entity := range streamEntities {
		entries = append(entries, SnapshotEntry{entity.EntityType, entity.EntityID, entity.Version, entity.Mode, entity.Snapshot})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].EntityType == entries[j].EntityType {
			return entries[i].EntityID < entries[j].EntityID
		}
		return entries[i].EntityType < entries[j].EntityType
	})
	canonical, err := json.Marshal(entries)
	if err != nil {
		return CatalogSnapshot{}, err
	}
	sum := sha256.Sum256(canonical)
	result := CatalogSnapshot{SchemaVersion: 1, Watermark: watermark, GeneratedAt: time.Now().UTC(), Checksum: hex.EncodeToString(sum[:]), Entities: entries}
	if err = tx.Commit(ctx); err != nil {
		return CatalogSnapshot{}, err
	}
	return result, nil
}

func buildCatalogEntityEnvelope(entity catalogStreamEntity, sequence int64) ([]byte, error) {
	messageID := domain.NewID()
	payload := map[string]any{"entityType": entity.EntityType, "entityId": entity.EntityID, "entityVersion": entity.Version, "fullSnapshot": entity.Snapshot, "effectiveAt": entity.EffectiveAt, "streamSequence": sequence, "mode": entity.Mode}
	envelope := map[string]any{"messageId": messageID, "messageKind": "EVENT", "messageType": "CatalogChanged", "schemaVersion": 1, "producer": "catalog", "aggregateId": entity.AggregateID, "aggregateVersion": entity.Version, "correlationId": "catalog-bootstrap", "causationId": messageID, "requestId": messageID, "occurredAt": entity.EffectiveAt, "payload": payload}
	return json.Marshal(envelope)
}

func catalogSnapshotEntities(ctx context.Context, tx pgx.Tx, at time.Time) ([]catalogStreamEntity, error) {
	entities := []catalogStreamEntity{}
	add := func(kind, id, aggregate string, version int, snapshot any, status string) {
		mode := "UPSERT"
		if status == "INACTIVE" {
			mode = "TOMBSTONE"
		}
		entities = append(entities, catalogStreamEntity{kind, id, aggregate, version, snapshot, at, mode})
	}
	rows, err := tx.Query(ctx, `SELECT id::text,code,name,status FROM departments ORDER BY id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v domain.Department
		if err = rows.Scan(&v.ID, &v.Code, &v.Name, &v.Status); err != nil {
			rows.Close()
			return nil, err
		}
		add("DEPARTMENT", v.ID, v.ID, 1, v, v.Status)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	rows, err = tx.Query(ctx, `SELECT id::text,identity_user_id::text,department_id::text,display_name,status FROM doctors ORDER BY id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v struct {
			ID             string `json:"id"`
			IdentityUserID string `json:"identityUserId"`
			DepartmentID   string `json:"departmentId"`
			DisplayName    string `json:"displayName"`
			Status         string `json:"status"`
		}
		if err = rows.Scan(&v.ID, &v.IdentityUserID, &v.DepartmentID, &v.DisplayName, &v.Status); err != nil {
			rows.Close()
			return nil, err
		}
		add("DOCTOR", v.ID, v.ID, 1, v, v.Status)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	rows, err = tx.Query(ctx, `SELECT id::text,department_id::text,code,name,status FROM medical_services ORDER BY id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v domain.MedicalService
		if err = rows.Scan(&v.ID, &v.DepartmentID, &v.Code, &v.Name, &v.Status); err != nil {
			rows.Close()
			return nil, err
		}
		v.Price = nil
		add("SERVICE", v.ID, v.ID, 1, v, v.Status)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	rows, err = tx.Query(ctx, `SELECT id::text,code,name,unit,strength,form,status FROM medicines ORDER BY id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v domain.Medicine
		if err = rows.Scan(&v.ID, &v.Code, &v.Name, &v.Unit, &v.Strength, &v.Form, &v.Status); err != nil {
			rows.Close()
			return nil, err
		}
		v.Price = nil
		add("MEDICINE", v.ID, v.ID, 1, v, v.Status)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	rows, err = tx.Query(ctx, `SELECT id::text,code,name,specimen_type,unit,reference_range,revision,status FROM lab_tests ORDER BY id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v domain.LabTest
		if err = rows.Scan(&v.ID, &v.Code, &v.Name, &v.SpecimenType, &v.Unit, &v.ReferenceRange, &v.Revision, &v.Status); err != nil {
			rows.Close()
			return nil, err
		}
		v.Price = nil
		add("LAB_TEST", v.ID, v.ID, v.Revision, v, v.Status)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	rows, err = tx.Query(ctx, `SELECT id::text,item_type,item_id::text,revision,amount_vnd,effective_from,effective_to FROM price_versions ORDER BY item_type,item_id,revision`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v domain.Price
		if err = rows.Scan(&v.PriceVersionID, &v.ItemType, &v.ItemID, &v.Revision, &v.AmountVND, &v.EffectiveFrom, &v.EffectiveTo); err != nil {
			rows.Close()
			return nil, err
		}
		entities = append(entities, catalogStreamEntity{"PRICE_VERSION", v.PriceVersionID, v.ItemID, v.Revision, v, v.EffectiveFrom, "UPSERT"})
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	return entities, nil
}

// EnsureCheckpoint writes at most one durable stream heartbeat per ten seconds.
func (s *Store) BootstrapCatalogStream(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var sequence, generation int64
	var complete *time.Time
	if err = tx.QueryRow(ctx, `SELECT sequence,generation,bootstrap_completed_at FROM catalog_stream WHERE singleton=true FOR UPDATE`).Scan(&sequence, &generation, &complete); err != nil {
		return err
	}
	if complete != nil {
		return tx.Commit(ctx)
	}
	entities, err := catalogSnapshotEntities(ctx, tx, time.Now().UTC())
	if err != nil {
		return err
	}
	for _, entity := range entities {
		sequence++
		generation++
		raw, buildErr := buildCatalogEntityEnvelope(entity, sequence)
		if buildErr != nil {
			return buildErr
		}
		if err = insertCatalogOutbox(ctx, tx, entity.AggregateID, entity.Version, raw); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE catalog_stream SET sequence=$1,generation=$2,bootstrap_completed_at=now() WHERE singleton=true`, sequence, generation)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) EnsureCheckpoint(ctx context.Context, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var sequence int64
	var bootstrappedAt, last *time.Time
	if err = tx.QueryRow(ctx, `SELECT sequence,bootstrap_completed_at,checkpoint_at FROM catalog_stream WHERE singleton=true FOR UPDATE`).Scan(&sequence, &bootstrappedAt, &last); err != nil {
		return err
	}
	if bootstrappedAt == nil {
		return fmt.Errorf("catalog snapshot bootstrap has not completed")
	}
	now = now.UTC()
	if last != nil && now.Sub(*last) < 10*time.Second {
		return tx.Commit(ctx)
	}
	messageID := domain.NewID()
	streamID := "00000000-0000-4000-8000-000000000000"
	payload := map[string]any{"entityType": "STREAM", "entityId": streamID, "entityVersion": 1, "fullSnapshot": map[string]any{"sequence": sequence, "at": now}, "effectiveAt": now, "streamSequence": sequence, "mode": "CHECKPOINT"}
	envelope := map[string]any{"messageId": messageID, "messageKind": "EVENT", "messageType": "CatalogChanged", "schemaVersion": 1, "producer": "catalog", "aggregateId": streamID, "aggregateVersion": 1, "correlationId": "catalog-checkpoint", "causationId": messageID, "requestId": messageID, "occurredAt": now, "payload": payload}
	raw, e := json.Marshal(envelope)
	if e != nil {
		return e
	}
	if e = insertCatalogOutbox(ctx, tx, streamID, 1, raw); e != nil {
		return e
	}
	if _, err = tx.Exec(ctx, `UPDATE catalog_stream SET checkpoint_at=$1 WHERE singleton=true`, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
