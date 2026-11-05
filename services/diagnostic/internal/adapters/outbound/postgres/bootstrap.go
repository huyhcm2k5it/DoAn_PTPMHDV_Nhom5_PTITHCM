package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/application/projection"
	"umccare/diagnostic/internal/domain"
)

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

type catalogPriceSnapshot struct {
	PriceVersionID string     `json:"priceVersionId"`
	ItemID         string     `json:"itemId"`
	ItemType       string     `json:"itemType"`
	AmountVND      int64      `json:"amountVnd"`
	Revision       int        `json:"revision"`
	EffectiveFrom  time.Time  `json:"effectiveFrom"`
	EffectiveTo    *time.Time `json:"effectiveTo"`
}

// ProjectionImport is an operator-only bootstrap; never routed through public HTTP.
type ProjectionImport struct {
	Kind    string          `json:"kind"`
	Key     string          `json:"key"`
	Value   json.RawMessage `json:"value"`
	Version int             `json:"version"`
}

func (p *Probe) ImportProjections(ctx context.Context, items []ProjectionImport) error {
	if len(items) < 1 || len(items) > 10000 {
		return domain.Fail("VALIDATION_ERROR", "One to 10000 projections required")
	}
	return p.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		for _, i := range items {
			if !domain.Has([]string{"access", "patient", "TEST", "DOCTOR", "LAB_PRICE", "catalog"}, i.Kind) || i.Version < 1 || !json.Valid(i.Value) {
				return domain.Fail("VALIDATION_ERROR", "Invalid trusted projection")
			}
			if i.Kind == "catalog" {
				var v struct {
					Sequence int
					At       string
				}
				if i.Key != "checkpoint" || json.Unmarshal(i.Value, &v) != nil || v.Sequence < 0 || v.At == "" {
					return domain.Fail("VALIDATION_ERROR", "Invalid checkpoint")
				}
			} else if !domain.ValidID(i.Key) {
				return domain.Fail("VALIDATION_ERROR", "Projection UUID required")
			}
			key := domain.ID(i.Key)
			if i.Kind == "catalog" {
				var incoming, current struct {
					Sequence int
					At       string
				}
				json.Unmarshal(i.Value, &incoming)
				raw, err := t.Get(ctx, "catalog", "checkpoint")
				if err == nil {
					json.Unmarshal(raw, &current)
					if incoming.Sequence < current.Sequence {
						continue
					}
				} else if domain.Code(err) != "NOT_FOUND" {
					return err
				}
			}
			if e := projection.Put(ctx, t, i.Kind, key, i.Version, i.Value); e != nil {
				return e
			}
		}
		return nil
	})
}

// ImportCatalogSnapshot consumes Catalog's verified operator export. Live replay
// must continue strictly after the imported watermark.
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
	return p.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		var current struct {
			Sequence int64     `json:"sequence"`
			At       time.Time `json:"at"`
		}
		raw, getErr := t.Get(ctx, "catalog", "checkpoint")
		if getErr == nil {
			if json.Unmarshal(raw, &current) != nil {
				return domain.Fail("SERVICE_UNAVAILABLE", "Invalid Catalog checkpoint projection")
			}
			if snapshot.Watermark < current.Sequence {
				return nil
			}
		} else if domain.Code(getErr) != "NOT_FOUND" {
			return getErr
		}
		priceHistory := map[string][]catalogPriceSnapshot{}
		for _, item := range snapshot.Entities {
			if !domain.ValidID(item.EntityID) || item.EntityVersion < 1 || (item.Mode != "UPSERT" && item.Mode != "TOMBSTONE") || !json.Valid(item.FullSnapshot) {
				return domain.Fail("VALIDATION_ERROR", "Invalid Catalog snapshot entity")
			}
			switch item.EntityType {
			case "LAB_TEST", "DOCTOR", "MEDICINE":
				kind := item.EntityType
				if kind == "LAB_TEST" {
					kind = "TEST"
				}
				value := item.FullSnapshot
				if item.Mode == "TOMBSTONE" {
					var object map[string]any
					if json.Unmarshal(value, &object) != nil {
						return domain.Fail("VALIDATION_ERROR", "Invalid Catalog tombstone")
					}
					object["status"] = "INACTIVE"
					value, err = json.Marshal(object)
					if err != nil {
						return err
					}
				}
				if err = projection.Put(ctx, t, kind, domain.ID(item.EntityID), item.EntityVersion, value); err != nil {
					return err
				}
			case "PRICE_VERSION":
				if item.Mode == "TOMBSTONE" {
					continue
				}
				var price catalogPriceSnapshot
				if json.Unmarshal(item.FullSnapshot, &price) != nil {
					return domain.Fail("VALIDATION_ERROR", "Invalid price snapshot")
				}
				if price.ItemType != "LAB" {
					continue
				}
				if !domain.ValidID(price.ItemID) || domain.ID(price.PriceVersionID) != domain.ID(item.EntityID) || price.Revision != item.EntityVersion || price.AmountVND < 0 || price.EffectiveFrom.IsZero() {
					return domain.Fail("VALIDATION_ERROR", "Invalid LAB price snapshot")
				}
				priceHistory[domain.ID(price.ItemID)] = append(priceHistory[domain.ID(price.ItemID)], price)
			}
		}
		for itemID, history := range priceHistory {
			if err = t.Put(ctx, "LAB_PRICES", itemID, history); err != nil {
				return err
			}
		}
		if err = t.Put(ctx, "catalog", "checkpoint", map[string]any{"sequence": snapshot.Watermark, "at": snapshot.GeneratedAt.UTC()}); err != nil {
			return err
		}
		return t.Put(ctx, "catalog", "highest_observed", snapshot.Watermark)
	})
}
