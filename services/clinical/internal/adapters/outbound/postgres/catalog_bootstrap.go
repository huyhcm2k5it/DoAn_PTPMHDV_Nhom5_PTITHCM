package postgres

import (
	"context"
	"encoding/json"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

type CatalogImport struct {
	Kind   string               `json:"kind"`
	Entity domain.CatalogEntity `json:"entity"`
}

// ImportCatalog accepts a trusted operator export, never a public/user request.
func (p *Probe) ImportCatalog(ctx context.Context, entries []CatalogImport) error {
	if len(entries) > 10000 {
		return domain.Fail("VALIDATION_ERROR", "Too many catalog entries")
	}
	return p.Within(ctx, "catalog-import", func(base ports.ClinicalTx) error {
		tx := base.(clinicalTx)
		for _, entry := range entries {
			v := entry.Entity
			v.ID = domain.ID(v.ID)
			if (entry.Kind != "MEDICINE" && entry.Kind != "LAB_TEST") || !domain.ValidID(v.ID) || v.Code == "" || v.Name == "" || v.Revision < 1 || (v.Status != "ACTIVE" && v.Status != "INACTIVE") {
				return domain.Fail("VALIDATION_ERROR", "Invalid trusted catalog entity")
			}
			var previous []byte
			e := tx.tx.QueryRow(ctx, `SELECT jsonb_build_object('id',entity_id,'code',code,'name',name,'unit',unit,'referenceRange',reference_range,'revision',revision,'status',status) FROM catalog_entity_projection WHERE entity_type=$1 AND entity_id=$2 FOR UPDATE`, entry.Kind, v.ID).Scan(&previous)
			if e == nil {
				var prior domain.CatalogEntity
				if e = json.Unmarshal(previous, &prior); e != nil {
					return e
				}
				if prior.Revision == v.Revision && domain.Hash(prior) != domain.Hash(v) {
					return domain.Fail("STATE_CONFLICT", "Catalog version content conflicts")
				}
				if prior.Revision >= v.Revision {
					continue
				}
			}
			if e = tx.PutCatalog(ctx, entry.Kind, v); e != nil {
				return e
			}
		}
		return nil
	})
}
