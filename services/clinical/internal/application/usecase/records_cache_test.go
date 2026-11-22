package usecase

import (
	"context"
	"errors"
	"testing"
	"time"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

type recordsCacheFixture struct {
	ports.ClinicalTx
	owner, patient string
	access         domain.Access
	version        string
	records        domain.MedicalRecords
	reads          int
}

func (f *recordsCacheFixture) RecordsCacheVersion(context.Context, string, string, time.Time) (string, error) {
	return f.version, nil
}
func (f *recordsCacheFixture) Access(context.Context, string) (domain.Access, error) {
	return f.access, nil
}
func (f *recordsCacheFixture) PatientAccess(context.Context, string) (domain.PatientAccess, error) {
	return domain.PatientAccess{PatientID: f.patient, OwnerUserID: f.owner, Active: true}, nil
}
func (f *recordsCacheFixture) PatientRecords(context.Context, string, int, int) (domain.MedicalRecords, error) {
	f.reads++
	return f.records, nil
}

type recordsFixtureStore struct{ tx *recordsCacheFixture }

func (s recordsFixtureStore) Within(ctx context.Context, _ string, fn func(ports.ClinicalTx) error) error {
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
	visit := domain.NewID()
	f.records = domain.MedicalRecords{Items: []domain.MedicalRecord{{Visit: domain.Visit{ID: visit, PatientID: patient, State: "SIGNED"}, Note: domain.VisitNote{VisitID: visit}, Prescriptions: []domain.Prescription{}}}, Total: 1}
	cache := &recordsMemoryCache{data: map[string][]byte{}}
	app := NewCached(recordsFixtureStore{f}, func() time.Time { return now }, cache)
	principal := domain.Principal{UserID: owner, ActorType: "PATIENT", TokenVersion: 1, LeaseAction: "CL-011", LeaseExpiresAt: now.Add(20 * time.Second)}
	for i := 0; i < 2; i++ {
		if _, err := app.Records(ctx, principal, patient, 1, 10); err != nil {
			t.Fatal(err)
		}
	}
	if f.reads != 1 || cache.gets != 2 {
		t.Fatalf("not a real cache hit: reads=%d gets=%d", f.reads, cache.gets)
	}
	gets := cache.gets
	f.access.Status = "DISABLED"
	if _, err := app.Records(ctx, principal, patient, 1, 10); domain.Code(err) != "FORBIDDEN" {
		t.Fatal("revoked user used cache", err)
	}
	if cache.gets != gets {
		t.Fatal("cache read before authorization")
	}
	f.access.Status = "ACTIVE"
	f.version = "second"
	if _, err := app.Records(ctx, principal, patient, 1, 10); err != nil {
		t.Fatal(err)
	}
	if f.reads != 2 {
		t.Fatal("new database version reused old page")
	}
	cache.fail = true
	if _, err := app.Records(ctx, principal, patient, 1, 10); err != nil || f.reads != 3 {
		t.Fatal("Redis failure broke authoritative read", err)
	}
	cache.fail = false
	for k := range cache.data {
		cache.data[k] = []byte("broken-json")
	}
	if _, err := app.Records(ctx, principal, patient, 1, 10); err != nil || f.reads != 4 {
		t.Fatal("corrupt cache did not reload", err)
	}
	cache.onGet = func() { now = now.Add(time.Minute) }
	if _, err := app.Records(ctx, principal, patient, 1, 10); domain.Code(err) != "AUTHZ_LEASE_EXPIRED" {
		t.Fatal("cache bypassed lease expiry", err)
	}
}
