//go:build integration

package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

func TestCatalogSnapshotImportChecksumAndWatermark(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	id := domain.NewID()
	raw, _ := json.Marshal(domain.CatalogEntity{ID: id, Code: "MED-SNAPSHOT", Name: "Imported medicine", Revision: 3, Status: "ACTIVE"})
	entries := []CatalogSnapshotEntry{{EntityType: "MEDICINE", EntityID: id, EntityVersion: 3, Mode: "UPSERT", FullSnapshot: raw}}
	canonical, _ := json.Marshal(entries)
	sum := sha256.Sum256(canonical)
	snapshot := CatalogSnapshotImport{SchemaVersion: 1, Watermark: 9, GeneratedAt: time.Now().UTC(), Checksum: hex.EncodeToString(sum[:]), Entities: entries}
	if err := db.ImportCatalogSnapshot(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	var sequence, highest int64
	var name string
	if err := db.pool.QueryRow(ctx, `SELECT sequence,highest_observed FROM catalog_stream_state WHERE singleton=true`).Scan(&sequence, &highest); err != nil || sequence != 9 || highest != 9 {
		t.Fatalf("watermark %d/%d err=%v", sequence, highest, err)
	}
	if err := db.pool.QueryRow(ctx, `SELECT name FROM catalog_entity_projection WHERE entity_type='MEDICINE' AND entity_id=$1`, id).Scan(&name); err != nil || name != "Imported medicine" {
		t.Fatalf("entity %q err=%v", name, err)
	}
	snapshot.Checksum = strings.Repeat("0", 64)
	if err := db.ImportCatalogSnapshot(ctx, snapshot); domain.Code(err) != "VALIDATION_ERROR" {
		t.Fatal("corrupt snapshot accepted", err)
	}
}

func catalogMessage(messageID string, sequence int64, mode, entityType, entityID string, snapshot any, at time.Time) domain.Envelope {
	payload, _ := json.Marshal(map[string]any{"entityType": entityType, "entityId": entityID, "entityVersion": 1, "fullSnapshot": snapshot, "effectiveAt": at, "streamSequence": sequence, "mode": mode})
	return domain.Envelope{MessageID: messageID, MessageKind: "EVENT", MessageType: "CatalogChanged", SchemaVersion: 1, Producer: "catalog", AggregateID: entityID, AggregateVersion: 1, CorrelationID: domain.NewID(), CausationID: domain.NewID(), RequestID: domain.NewID(), OccurredAt: at, Payload: payload}
}

func TestCatalogGapDoesNotAdvanceCheckpointAndFreshnessGuard(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	entityID := domain.NewID()
	if _, err := db.pool.Exec(ctx, `INSERT INTO catalog_entity_projection(entity_type,entity_id,code,name,revision,status) VALUES('LAB_TEST',$1,$2,'CBC',1,'ACTIVE')`, entityID, entityID); err != nil {
		t.Fatal(err)
	}
	service := usecase.New(db, time.Now)
	now := time.Now().UTC()
	checkpointID := domain.NewID()
	checkpoint := catalogMessage(checkpointID, 2, "CHECKPOINT", "STREAM", "00000000-0000-4000-8000-000000000000", map[string]any{"sequence": 2, "at": now}, now)
	if err := service.HandleTreatmentMessage(ctx, "umc.events.catalog.v1", checkpoint); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("ahead checkpoint should leave an open gap: %v", err)
	}
	var sequence, highest int64
	if err := db.pool.QueryRow(ctx, `SELECT sequence,highest_observed FROM catalog_stream_state WHERE singleton=true`).Scan(&sequence, &highest); err != nil || sequence != 1 || highest != 2 {
		t.Fatalf("gap state sequence=%d highest=%d err=%v", sequence, highest, err)
	}
	readTest := func() error {
		tx, err := db.pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		_, err = (clinicalTx{tx}).LabTest(ctx, entityID)
		return err
	}
	if err := readTest(); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("known stream gap must block treatment reads: %v", err)
	}
	eventID := domain.NewID()
	event := catalogMessage(eventID, 2, "UPSERT", "DEPARTMENT", entityID, map[string]string{"id": entityID}, now)
	if err := service.HandleTreatmentMessage(ctx, "umc.events.catalog.v1", event); err != nil {
		t.Fatalf("next missing sequence should apply: %v", err)
	}
	if err := service.HandleTreatmentMessage(ctx, "umc.events.catalog.v1", checkpoint); err != nil {
		t.Fatalf("same-watermark checkpoint should close the gap: %v", err)
	}
	if err := readTest(); err != nil {
		t.Fatalf("fresh caught-up stream should allow Catalog read: %v", err)
	}
	if _, err := db.pool.Exec(ctx, `UPDATE catalog_stream_state SET checkpoint_at=now()-interval '31 seconds' WHERE singleton=true`); err != nil {
		t.Fatal(err)
	}
	if err := readTest(); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("stale checkpoint must block treatment reads: %v", err)
	}
}
