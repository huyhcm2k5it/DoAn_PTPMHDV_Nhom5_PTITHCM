package usecase

import (
	"context"
	"testing"
	"time"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
)

type clock struct{ t time.Time }

func (c clock) Now() time.Time { return c.t }

type reader struct {
	ports.Reader
	access domain.Access
	calls  int
}

func (r *reader) Access(context.Context, string) (domain.Access, error) { return r.access, nil }
func (r *reader) Doctors(_ context.Context, q ports.DoctorQuery) (ports.Doctors, error) {
	r.calls++
	if q.Page != 1 || q.Limit != 20 {
		panic("bad defaults")
	}
	return ports.Doctors{Items: []domain.Doctor{}, Total: 0}, nil
}
func TestPaginationAndPermission(t *testing.T) {
	r := &reader{access: domain.Access{UserID: "user", ActorType: "STAFF", Status: "ACTIVE", Capabilities: []string{"PHARMACY"}, TokenVersion: 1}}
	s := New(r, nil, clock{time.Now()})
	if _, e := s.Doctors(context.Background(), ports.DoctorQuery{Limit: 101}); domain.Code(e) != "VALIDATION_ERROR" {
		t.Fatal(e)
	}
	if r.calls != 0 {
		t.Fatal("invalid query reached repository")
	}
	if _, e := s.Doctors(context.Background(), ports.DoctorQuery{}); e != nil {
		t.Fatal(e)
	}
	p := domain.Principal{UserID: "user", ActorType: "STAFF", Capabilities: []string{"ADMIN"}, TokenVersion: 1, LeaseAction: "CA-004"}
	if _, e := s.CreatePrice(context.Background(), p, domain.NewID(), domain.PriceInput{}, ports.Meta{}); domain.Code(e) != "FORBIDDEN" {
		t.Fatalf("stale ADMIN claim accepted: %v", e)
	}
}

type txs struct{ tx *priceTx }

func (x txs) Within(ctx context.Context, actor, key string, f func(ports.PriceTx) error) error {
	return f(x.tx)
}

type priceTx struct {
	ports.PriceTx
	stored  *domain.PriceResult
	hash    string
	inserts int
	events  int
}

func (x *priceTx) Replay(context.Context, string, string) (domain.PriceResult, string, bool, error) {
	if x.stored == nil {
		return domain.PriceResult{}, "", false, nil
	}
	return *x.stored, x.hash, true, nil
}
func (x *priceTx) LockItem(context.Context, string, string) (bool, error)    { return true, nil }
func (x *priceTx) Overlap(context.Context, domain.PriceInput) (bool, error)  { return false, nil }
func (x *priceTx) NextRevision(context.Context, string, string) (int, error) { return 1, nil }
func (x *priceTx) InsertPrice(context.Context, domain.Price) error           { x.inserts++; return nil }
func (x *priceTx) SaveReplay(_ context.Context, _, _, hash string, r domain.PriceResult) error {
	x.stored = &r
	x.hash = hash
	return nil
}
func (x *priceTx) NextSequence(context.Context) (int64, error)        { return 1, nil }
func (x *priceTx) AppendChanged(context.Context, ports.Changed) error { x.events++; return nil }
func TestRetryAfterEffectiveTimeReturnsOriginal(t *testing.T) {
	now := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	db := &priceTx{}
	r := &reader{access: domain.Access{ActorType: "STAFF", Status: "ACTIVE", Capabilities: []string{"ADMIN"}, TokenVersion: 1}}
	p := domain.Principal{UserID: "user", ActorType: "STAFF", Capabilities: []string{"ADMIN"}, TokenVersion: 1, LeaseAction: "CA-004"}
	s := New(r, txs{db}, clock{now})
	input := domain.PriceInput{ItemType: "EXAM", ItemID: domain.NewID(), AmountVND: 20, EffectiveFrom: now.Add(time.Hour)}
	key := domain.NewID()
	a, err := s.CreatePrice(context.Background(), p, key, input, ports.Meta{})
	if err != nil {
		t.Fatal(err)
	}
	s.clock = clock{now.Add(2 * time.Hour)}
	b, err := s.CreatePrice(context.Background(), p, key, input, ports.Meta{})
	if err != nil || a != b {
		t.Fatalf("retry: %v %v", b, err)
	}
	input.AmountVND++
	if _, e := s.CreatePrice(context.Background(), p, key, input, ports.Meta{}); domain.Code(e) != "IDEMPOTENCY_CONFLICT" {
		t.Fatal(e)
	}
	if db.inserts != 1 || db.events != 1 {
		t.Fatalf("side effects: %d %d", db.inserts, db.events)
	}
}
