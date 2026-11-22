package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

type recordsCacheFixture struct {
	ports.Tx
	owner, patient string
	access         domain.Access
	version        string
	records        domain.PublishedResults
	reads          int
}

func (f *recordsCacheFixture) RecordsCacheVersion(context.Context, string, string, time.Time) (string, error) {
	return f.version, nil
}
func (f *recordsCacheFixture) Get(_ context.Context, kind, key string) (json.RawMessage, error) {
	if kind == "access" {
		return json.Marshal(f.access)
	}
	if kind == "patient" {
		return json.Marshal(map[string]any{"ownerUserId": f.owner, "active": true})
	}
	return nil, domain.Fail("NOT_FOUND", "Record not found")
}
func (f *recordsCacheFixture) PublishedResultsForPatient(context.Context, string, int, int) (domain.PublishedResults, error) {
	f.reads++
	return f.records, nil
}

type recordsFixtureStore struct{ tx *recordsCacheFixture }

func (s recordsFixtureStore) Within(ctx context.Context, _ string, fn func(ports.Tx) error) error {
	return fn(s.tx)
}

type recordsMemoryCache struct {
	data  map[string][]byte
	gets  int
	fail  bool
	onGet func()
}

func (c *recordsMemoryCache) Get(_ context.Context, key string) ([]byte, bool, error) {
	c.gets++
	if c.onGet != nil {
		c.onGet()
	}
	if c.fail {
		return nil, false, errors.New("Redis unavailable")
	}
	raw, ok := c.data[key]
	return raw, ok, nil
}
func (c *recordsMemoryCache) Set(_ context.Context, key string, raw []byte, _ time.Duration) error {
	if c.fail {
		return errors.New("Redis unavailable")
	}
	c.data[key] = append([]byte(nil), raw...)
	return nil
}

func TestRecordsCacheChecksAccessVersionAndFailureFallback(t *testing.T) {
	ctx := context.Background()
	now := time.Now()
	owner, patient := domain.NewID(), domain.NewID()
	f := &recordsCacheFixture{owner: owner, patient: patient, version: "first", access: domain.Access{UserID: owner, ActorType: "PATIENT", Status: "ACTIVE", TokenVersion: 1}}
	f.records = domain.PublishedResults{Items: []domain.Result{{ID: domain.NewID(), State: "PUBLISHED", PublishedAt: &now}}, Total: 1}
	cache := &recordsMemoryCache{data: map[string][]byte{}}
	app := NewCached(recordsFixtureStore{f}, func() time.Time { return now }, cache)
	principal := domain.Principal{UserID: owner, ActorType: "PATIENT", TokenVersion: 1, LeaseAction: "DI-013", LeaseExpiresAt: now.Add(20 * time.Second)}
	for i := 0; i < 2; i++ {
		if _, err := app.PublishedResults(ctx, principal, patient, 1, 10); err != nil {
			t.Fatal(err)
		}
	}
	if f.reads != 1 || cache.gets != 2 {
		t.Fatalf("not a real cache hit: reads=%d gets=%d", f.reads, cache.gets)
	}
	gets := cache.gets
	f.access.Status = "DISABLED"
	if _, err := app.PublishedResults(ctx, principal, patient, 1, 10); domain.Code(err) != "FORBIDDEN" {
		t.Fatal("revoked user used cache", err)
	}
	if cache.gets != gets {
		t.Fatal("cache read before authorization")
	}
	f.access.Status = "ACTIVE"
	f.version = "second"
	if _, err := app.PublishedResults(ctx, principal, patient, 1, 10); err != nil {
		t.Fatal(err)
	}
	if f.reads != 2 {
		t.Fatal("new database version reused old page")
	}
	cache.fail = true
	if _, err := app.PublishedResults(ctx, principal, patient, 1, 10); err != nil || f.reads != 3 {
		t.Fatal("Redis failure broke authoritative read", err)
	}
	cache.fail = false
	for k := range cache.data {
		cache.data[k] = []byte("broken-json")
	}
	if _, err := app.PublishedResults(ctx, principal, patient, 1, 10); err != nil || f.reads != 4 {
		t.Fatal("corrupt cache did not reload", err)
	}
	cache.onGet = func() { now = now.Add(time.Minute) }
	if _, err := app.PublishedResults(ctx, principal, patient, 1, 10); domain.Code(err) != "AUTHZ_LEASE_EXPIRED" {
		t.Fatal("cache bypassed lease expiry", err)
	}
}
