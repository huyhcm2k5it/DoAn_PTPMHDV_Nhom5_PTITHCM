package usecase

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
)

type memoryCache struct {
	mu         sync.Mutex
	generation string
	down       bool
	items      map[string][]byte
	keys       []string
	lastExpiry time.Time
	getCalls   int
	bumps      int
}

func (c *memoryCache) Generation(context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.down {
		return "", errors.New("redis unavailable")
	}
	if c.generation == "" {
		c.generation = "generation-1"
	}
	return c.generation, nil
}
func (c *memoryCache) Get(_ context.Context, key string) ([]byte, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.getCalls++
	if c.down {
		return nil, false, errors.New("redis unavailable")
	}
	raw, ok := c.items[key]
	return raw, ok, nil
}
func (c *memoryCache) Set(_ context.Context, key string, value []byte, expiresAt time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.down {
		return errors.New("redis unavailable")
	}
	if c.items == nil {
		c.items = map[string][]byte{}
	}
	c.items[key] = append([]byte(nil), value...)
	c.keys = append(c.keys, key)
	c.lastExpiry = expiresAt
	return nil
}
func (c *memoryCache) BumpGeneration(context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.down {
		return errors.New("redis unavailable")
	}
	c.generation = "generation-next"
	c.bumps++
	return nil
}

type cacheReader struct {
	ports.Reader
	departments int
	services    int
	boundary    *time.Time
	block       chan struct{}
	entered     chan struct{}
	access      domain.Access
}

func (r *cacheReader) Departments(context.Context) ([]domain.Department, error) {
	r.departments++
	if r.entered != nil {
		select {
		case r.entered <- struct{}{}:
		default:
		}
	}
	if r.block != nil {
		<-r.block
	}
	return []domain.Department{{ID: domain.NewID(), Code: "CARD", Name: "Cardiology", Status: "ACTIVE"}}, nil
}
func (r *cacheReader) MedicalServices(context.Context, ports.ServiceQuery) ([]domain.MedicalService, error) {
	r.services++
	return []domain.MedicalService{{ID: domain.NewID(), Name: "Exam", Status: "ACTIVE"}}, nil
}
func (r *cacheReader) NextPriceBoundary(context.Context, time.Time) (*time.Time, error) {
	return r.boundary, nil
}
func (r *cacheReader) Access(context.Context, string) (domain.Access, error) { return r.access, nil }

func TestCacheKeyIncludesFiltersAndTime(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	cache := &memoryCache{}
	r := &cacheReader{}
	s := NewCached(r, nil, clock{now}, cache, 2)
	departmentA := domain.NewID()
	departmentB := domain.NewID()
	if _, err := s.MedicalServices(context.Background(), ports.ServiceQuery{DepartmentID: departmentA, At: now}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MedicalServices(context.Background(), ports.ServiceQuery{DepartmentID: departmentB, At: now.Add(time.Second)}); err != nil {
		t.Fatal(err)
	}
	if len(cache.keys) != 2 || cache.keys[0] == cache.keys[1] {
		t.Fatalf("cache keys did not include all filters and time: %v", cache.keys)
	}
	for _, key := range cache.keys {
		if !strings.HasPrefix(key, "umc:catalog:v1:generation-1:") {
			t.Fatalf("unexpected key namespace: %s", key)
		}
	}
}

func TestPriceBoundaryInvalidatesCachedQuote(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	boundary := now.Add(1500 * time.Millisecond)
	cache := &memoryCache{}
	r := &cacheReader{boundary: &boundary}
	s := NewCached(r, nil, clock{now}, cache, 1)
	if _, err := s.MedicalServices(context.Background(), ports.ServiceQuery{At: now}); err != nil {
		t.Fatal(err)
	}
	if !cache.lastExpiry.After(now) || cache.lastExpiry.After(boundary) {
		t.Fatalf("cache outlives price boundary: %v", cache.lastExpiry)
	}
}

func TestExplicitAtDoesNotReuseCurrentTimeBucket(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 30, 0, time.UTC)
	cache := &memoryCache{}
	r := &cacheReader{}
	s := NewCached(r, nil, clock{now}, cache, 1)
	if _, err := s.MedicalServices(context.Background(), ports.ServiceQuery{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MedicalServices(context.Background(), ports.ServiceQuery{At: now.Truncate(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if r.services != 2 || len(cache.keys) != 2 || cache.keys[0] == cache.keys[1] {
		t.Fatal("explicit timestamp reused the current-time cache entry")
	}
}

func TestRedisDownUsesBoundedDBFallback(t *testing.T) {
	cache := &memoryCache{down: true}
	r := &cacheReader{block: make(chan struct{}), entered: make(chan struct{}, 1)}
	s := NewCached(r, nil, clock{time.Now()}, cache, 1)
	done := make(chan error, 1)
	go func() { _, err := s.Departments(context.Background()); done <- err }()
	<-r.entered
	if _, err := s.Departments(context.Background()); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("unbounded fallback was accepted: %v", err)
	}
	close(r.block)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestCacheGenerationChangesAfterCommit(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	cache := &memoryCache{generation: "generation-7"}
	db := &priceTx{}
	r := &reader{access: domain.Access{ActorType: "STAFF", Status: "ACTIVE", Capabilities: []string{"ADMIN"}, TokenVersion: 1}}
	p := domain.Principal{UserID: "user", ActorType: "STAFF", Capabilities: []string{"ADMIN"}, TokenVersion: 1, LeaseAction: "CA-004", LeaseExpiresAt: now.Add(24 * time.Hour)}
	s := NewCached(r, txs{db}, clock{now}, cache, 1)
	input := domain.PriceInput{ItemType: "EXAM", ItemID: domain.NewID(), AmountVND: 20, EffectiveFrom: now.Add(time.Hour)}
	key := domain.NewID()
	if _, err := s.CreatePrice(context.Background(), p, key, input, ports.Meta{}); err != nil {
		t.Fatal(err)
	}
	if cache.generation != "generation-next" || cache.bumps != 1 {
		t.Fatalf("generation not advanced after commit: generation=%s bumps=%d", cache.generation, cache.bumps)
	}
	if _, err := s.CreatePrice(context.Background(), p, key, input, ports.Meta{}); err != nil {
		t.Fatal(err)
	}
	if cache.bumps != 1 {
		t.Fatalf("idempotent replay invalidated cache again: %d", cache.bumps)
	}
}

func TestCacheCannotBypassAuthorization(t *testing.T) {
	cache := &memoryCache{generation: "generation-1", items: map[string][]byte{"malicious": []byte(`[{"id":"leaked"}]`)}}
	r := &cacheReader{access: domain.Access{UserID: "user", ActorType: "STAFF", Status: "ACTIVE", Capabilities: []string{"PHARMACY"}, TokenVersion: 1}}
	s := NewCached(r, nil, clock{time.Now()}, cache, 1)
	p := domain.Principal{UserID: "user", ActorType: "STAFF", Capabilities: []string{"LAB_TECH"}, TokenVersion: 1}
	if _, err := s.LabTests(context.Background(), p, ports.SearchQuery{}); domain.Code(err) != "FORBIDDEN" {
		t.Fatalf("authorization was bypassed: %v", err)
	}
	if cache.getCalls != 0 {
		t.Fatalf("cache was read before authorization: %d", cache.getCalls)
	}
}

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
	access  *domain.Access
	onLock  func()
}

func (x *priceTx) AccessForShare(context.Context, string) (domain.Access, error) {
	if x.access != nil {
		return *x.access, nil
	}
	return domain.Access{ActorType: "STAFF", Status: "ACTIVE", Capabilities: []string{"ADMIN"}, TokenVersion: 1}, nil
}
func (x *priceTx) Replay(context.Context, string, string) (domain.PriceResult, string, bool, error) {
	if x.stored == nil {
		return domain.PriceResult{}, "", false, nil
	}
	return *x.stored, x.hash, true, nil
}
func (x *priceTx) LockItem(context.Context, string, string) (bool, error) {
	if x.onLock != nil {
		x.onLock()
	}
	return true, nil
}
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

func TestPriceAuthorizationRecheckedInsideTransaction(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	active := domain.Access{ActorType: "STAFF", Status: "ACTIVE", Capabilities: []string{"ADMIN"}, TokenVersion: 1}
	p := domain.Principal{UserID: "user", ActorType: "STAFF", Capabilities: []string{"ADMIN"}, TokenVersion: 1, LeaseAction: "CA-004", LeaseExpiresAt: now.Add(30 * time.Second)}
	input := domain.PriceInput{ItemType: "EXAM", ItemID: domain.NewID(), AmountVND: 20, EffectiveFrom: now.Add(time.Hour)}
	r := &reader{access: active}
	revoked := active
	revoked.Status = "INACTIVE"
	tx := &priceTx{access: &revoked}
	s := New(r, txs{tx}, clock{now})
	if _, err := s.CreatePrice(context.Background(), p, domain.NewID(), input, ports.Meta{}); domain.Code(err) != "FORBIDDEN" || tx.inserts != 0 {
		t.Fatalf("revoked administrator was accepted: %v", err)
	}
	tx = &priceTx{}
	s = New(r, txs{tx}, clock{now})
	tx.onLock = func() { s.clock = clock{now.Add(31 * time.Second)} }
	if _, err := s.CreatePrice(context.Background(), p, domain.NewID(), input, ports.Meta{}); domain.Code(err) != "FORBIDDEN" || tx.inserts != 0 {
		t.Fatalf("expired lease was accepted after item lock: %v", err)
	}
}

func TestRetryAfterEffectiveTimeReturnsOriginal(t *testing.T) {
	now := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	db := &priceTx{}
	r := &reader{access: domain.Access{ActorType: "STAFF", Status: "ACTIVE", Capabilities: []string{"ADMIN"}, TokenVersion: 1}}
	p := domain.Principal{UserID: "user", ActorType: "STAFF", Capabilities: []string{"ADMIN"}, TokenVersion: 1, LeaseAction: "CA-004", LeaseExpiresAt: now.Add(24 * time.Hour)}
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
