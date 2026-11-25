package usecase

import (
	"context"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
)

// History is an administrative read. Authorization is checked on every request;
// protected records are never served from a public catalog cache.
func (s *Service) PriceHistory(ctx context.Context, p domain.Principal, q ports.PriceQuery) (ports.PriceVersions, error) {
	if err := s.authorize(ctx, p, "ADMIN"); err != nil {
		return ports.PriceVersions{}, err
	}
	if q.Page == 0 {
		q.Page = 1
	}
	if q.Limit == 0 {
		q.Limit = 20
	}
	if q.Page < 1 || q.Page > 1000000 || q.Limit < 1 || q.Limit > 100 ||
		(q.ItemType != "" && !domain.Has([]string{"EXAM", "LAB", "MEDICINE"}, q.ItemType)) ||
		(q.ItemID != "" && !domain.ValidID(q.ItemID)) {
		return ports.PriceVersions{}, domain.Fail("VALIDATION_ERROR", "Invalid price history filter or pagination")
	}
	reader, ok := s.reader.(ports.PriceHistoryReader)
	if !ok {
		return ports.PriceVersions{}, domain.Fail("SERVICE_UNAVAILABLE", "Price history reader unavailable")
	}
	return reader.PriceHistory(ctx, q)
}
