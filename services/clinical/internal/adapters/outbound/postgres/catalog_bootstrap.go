package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

type CatalogImport struct {
	Kind   string               `json:"kind"`
	Entity domain.CatalogEntity `json:"entity"`
}

type CatalogSnapshotEntry struct {
	EntityType    string          `json:"entityType"`
	EntityID      string          `json:"entityId"`
	EntityVersion int             `json:"entityVersion"`
	Mode          string          `json:"mode"`
	FullSnapshot  json.RawMessage `json:"fullSnapshot"`
}

type CatalogSnapshotImport struct {
	SchemaVersion int                    `json:"schemaVersion"`
	Watermark     int64                  `json:"watermark"`
	GeneratedAt   time.Time              `json:"generatedAt"`
	Checksum      string                 `json:"checksum"`
	Entities      []CatalogSnapshotEntry `json:"entities"`
}

func importCatalogEntries(ctx context.Context, tx clinicalTx, entries []CatalogImport) error {
	for _, entry := range entries {
		v := entry.Entity
		v.ID = domain.ID(v.ID)
		if (entry.Kind != "MEDICINE" && entry.Kind != "LAB_TEST") || !domain.ValidID(v.ID) || v.Code == "" || v.Name == "" || v.Revision < 1 || (v.Status != "ACTIVE" && v.Status != "INACTIVE") {
			return domain.Fail("VALIDATION_ERROR", "Invalid trusted catalog entity")
		}
		var previous []byte
		err := tx.tx.QueryRow(ctx, `SELECT jsonb_build_object('id',entity_id,'code',code,'name',name,'unit',unit,'referenceRange',reference_range,'revision',revision,'status',status) FROM catalog_entity_projection WHERE entity_type=$1 AND entity_id=$2 FOR UPDATE`, entry.Kind, v.ID).Scan(&previous)
		if err == nil {
			var prior domain.CatalogEntity
			if err = json.Unmarshal(previous, &prior); err != nil {
				return err
			}
			if prior.Revision == v.Revision && domain.Hash(prior) != domain.Hash(v) {
				return domain.Fail("STATE_CONFLICT", "Catalog version content conflicts")
			}
			if prior.Revision >= v.Revision {
				continue
			}
		}
		if err = tx.PutCatalog(ctx, entry.Kind, v); err != nil {
			return err
		}
	}
	return nil
}

// ImportCatalog accepts a trusted operator export, never a public/user request.
func (p *Probe) ImportCatalog(ctx context.Context, entries []CatalogImport) error {
	if len(entries) > 10000 {
		return domain.Fail("VALIDATION_ERROR", "Too many catalog entries")
	}
	return p.Within(ctx, "catalog-import", func(base ports.ClinicalTx) error {
		return importCatalogEntries(ctx, base.(clinicalTx), entries)
	})
}

// ImportCatalogSnapshot verifies Catalog's checksum and atomically advances the
// consumer watermark with the imported medicine/LAB definitions.
func (p *Probe) ImportCatalogSnapshot(ctx context.Context, snapshot CatalogSnapshotImport) error {
	if snapshot.SchemaVersion != 1 || snapshot.Watermark < 0 || snapshot.GeneratedAt.IsZero() || len(snapshot.Entities) > 10000 {
		return domain.Fail("VALIDATION_ERROR", "Invalid Catalog snapshot envelope")
	}
	canonical, err := json.Marshal(snapshot.Entities)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(canonical)
	if !strings.EqualFold(snapshot.Checksum, hex.EncodeToString(sum[:])) {
		return domain.Fail("VALIDATION_ERROR", "Catalog snapshot checksum mismatch")
	}
	entries := make([]CatalogImport, 0)
	for _, item := range snapshot.Entities {
		if item.EntityType != "MEDICINE" && item.EntityType != "LAB_TEST" {
			continue
		}
		var entity domain.CatalogEntity
		if json.Unmarshal(item.FullSnapshot, &entity) != nil || domain.ID(entity.ID) != domain.ID(item.EntityID) || item.EntityVersion < 1 || (item.Mode != "UPSERT" && item.Mode != "TOMBSTONE") {
			return domain.Fail("VALIDATION_ERROR", "Invalid Catalog snapshot entity")
		}
		entity.Revision = item.EntityVersion
		if item.Mode == "TOMBSTONE" {
			entity.Status = "INACTIVE"
		}
		entries = append(entries, CatalogImport{Kind: item.EntityType, Entity: entity})
	}
	return p.Within(ctx, "catalog-import", func(base ports.ClinicalTx) error {
		tx := base.(clinicalTx)
		var current int64
		if err := tx.tx.QueryRow(ctx, `SELECT sequence FROM catalog_stream_state WHERE singleton=true FOR UPDATE`).Scan(&current); err != nil {
			return err
		}
		if snapshot.Watermark < current {
			return nil
		}
		if err := importCatalogEntries(ctx, tx, entries); err != nil {
			return err
		}
		_, err = tx.tx.Exec(ctx, `UPDATE catalog_stream_state SET sequence=$1,highest_observed=$1,checkpoint_at=$2 WHERE singleton=true`, snapshot.Watermark, snapshot.GeneratedAt.UTC())
		return err
	})
}
