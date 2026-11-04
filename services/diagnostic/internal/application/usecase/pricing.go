package usecase

import (
	"context"
	"time"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

type PriceProjection struct {
	PriceVersionID, ItemID, ItemType string
	AmountVND                        int64
	Revision                         int
	EffectiveFrom                    time.Time
	EffectiveTo                      *time.Time
}

func priceAt(ctx context.Context, t ports.Tx, id string, at time.Time) (PriceProjection, error) {
	var history []PriceProjection
	e := load(ctx, t, "LAB_PRICES", id, &history)
	if e != nil && domain.Code(e) != "NOT_FOUND" {
		return PriceProjection{}, e
	}
	if len(history) == 0 {
		var single PriceProjection
		if e = load(ctx, t, "LAB_PRICE", id, &single); e != nil {
			return single, domain.Fail("SERVICE_UNAVAILABLE", "Lab price projection unavailable")
		}
		history = []PriceProjection{single}
	}
	var selected PriceProjection
	for _, p := range history {
		var withdrawn time.Time
		e := load(ctx, t, "price_withdrawals", domain.ID(p.PriceVersionID), &withdrawn)
		if e != nil && domain.Code(e) != "NOT_FOUND" {
			return selected, e
		}
		if !withdrawn.IsZero() && !at.Before(withdrawn) {
			continue
		}
		if !p.EffectiveFrom.After(at) && (p.EffectiveTo == nil || p.EffectiveTo.After(at)) && p.Revision > selected.Revision {
			selected = p
		}
	}
	if selected.Revision == 0 {
		return selected, domain.Fail("SERVICE_UNAVAILABLE", "Lab price at authorization is unavailable")
	}
	return selected, nil
}
