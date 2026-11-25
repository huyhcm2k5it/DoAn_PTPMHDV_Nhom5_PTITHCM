package usecase

import (
	"context"
	"testing"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
)

type historyReader struct {
	*cacheReader
	reads int
	query ports.PriceQuery
}

func (r *historyReader) PriceHistory(_ context.Context, q ports.PriceQuery) (ports.PriceVersions, error) {
	r.reads++
	r.query = q
	return ports.PriceVersions{Items: []domain.PriceVersion{}, Total: 0}, nil
}
func TestHistoryChecksCurrentAdminBeforeReadingAndValidatesFilters(t *testing.T) {
	id := domain.NewID()
	r := &historyReader{cacheReader: &cacheReader{access: domain.Access{UserID: id, ActorType: "STAFF", Status: "ACTIVE", TokenVersion: 1, Capabilities: []string{"ADMIN"}}}}
	s := New(r, nil, ports.RealClock{})
	p := domain.Principal{UserID: id, ActorType: "STAFF", TokenVersion: 1, Capabilities: []string{"ADMIN"}}
	if _, err := s.PriceHistory(context.Background(), p, ports.PriceQuery{}); err != nil || r.reads != 1 || r.query.Page != 1 || r.query.Limit != 20 {
		t.Fatalf("history failed: %v query=%+v", err, r.query)
	}
	r.access.Capabilities = nil
	if _, err := s.PriceHistory(context.Background(), p, ports.PriceQuery{}); domain.Code(err) != "FORBIDDEN" || r.reads != 1 {
		t.Fatalf("revoked admin reached storage: %v", err)
	}
	r.access.Capabilities = []string{"ADMIN"}
	for _, q := range []ports.PriceQuery{{ItemID: "bad"}, {ItemType: "OTHER"}, {Page: -1}, {Limit: 101}} {
		if _, err := s.PriceHistory(context.Background(), p, q); domain.Code(err) != "VALIDATION_ERROR" || r.reads != 1 {
			t.Fatalf("invalid filter reached storage: %+v %v", q, err)
		}
	}
}
