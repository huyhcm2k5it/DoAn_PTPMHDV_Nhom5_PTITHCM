package postgres

import (
	"context"
	"encoding/json"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/application/projection"
	"umccare/diagnostic/internal/domain"
)

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
