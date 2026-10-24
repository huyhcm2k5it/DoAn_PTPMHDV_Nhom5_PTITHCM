//go:build integration

package postgres

import (
	"context"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/application/usecase"
	"umccare/catalog/internal/domain"
)

func TestRealPostgresTransactions(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	u, e := url.Parse(dsn)
	if e != nil || !strings.HasPrefix(u.Path, "/umc_huy_test") {
		t.Fatal("integration requires an isolated umc_huy_test* database via TEST_DATABASE_URL")
	}
	ctx := context.Background()
	db, e := New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = db.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if e = db.Seed(ctx); e != nil {
		t.Fatal(e)
	}
	if e = db.Seed(ctx); e != nil {
		t.Fatal("seed is not repeatable", e)
	}
	rows, e := db.Departments(ctx)
	if e != nil || len(rows) != 2 {
		t.Fatal(rows, e)
	}
	doctors, e := db.Doctors(ctx, ports.DoctorQuery{Page: 1, Limit: 1})
	if e != nil || doctors.Total != 2 || len(doctors.Items) != 1 {
		t.Fatal(doctors, e)
	}
	noPrice, e := db.MedicalServices(ctx, ports.ServiceQuery{At: time.Now().Add(365 * 24 * time.Hour)})
	if e != nil || len(noPrice) != 2 || noPrice[0].Price != nil {
		t.Fatalf("missing price must be null, not a zero-VND fabricated price: %+v %v", noPrice, e)
	}
	app := usecase.New(db, db, ports.RealClock{})
	admin := domain.Principal{UserID: "00000000-0000-4000-8000-000000000901", ActorType: "STAFF", Capabilities: []string{"ADMIN"}, TokenVersion: 1, LeaseAction: "CA-004"}
	future := time.Now().UTC().Add(15 * 24 * time.Hour).Truncate(time.Second)
	end := future.Add(time.Hour)
	input := domain.PriceInput{ItemType: "EXAM", ItemID: "00000000-0000-4000-8000-000000000201", AmountVND: 123456, EffectiveFrom: future, EffectiveTo: &end}
	key := domain.NewID()
	var wg sync.WaitGroup
	results := make(chan domain.PriceResult, 2)
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := app.CreatePrice(ctx, admin, key, input, ports.Meta{CorrelationID: domain.NewID(), RequestID: domain.NewID()})
			results <- r
			errs <- e
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal("idempotent concurrent write", err)
		}
	}
	var first string
	for r := range results {
		if first != "" && r.PriceVersionID != first {
			t.Fatal("duplicate price created")
		}
		first = r.PriceVersionID
	}
	var count int
	if e = db.pool.QueryRow(ctx, "SELECT count(*) FROM outbox WHERE aggregate_id=$1", input.ItemID).Scan(&count); e != nil || count != 1 {
		t.Fatal("outbox effect", count, e)
	}
	input.AmountVND++
	if _, e = app.CreatePrice(ctx, admin, key, input, ports.Meta{}); domain.Code(e) != "IDEMPOTENCY_CONFLICT" {
		t.Fatal(e)
	}
	if _, e = app.CreatePrice(ctx, admin, domain.NewID(), input, ports.Meta{}); domain.Code(e) != "OVERLAPPING_PRICE_PERIOD" {
		t.Fatal(e)
	}
	// Two independent requests for the same new interval must not both commit.
	input.EffectiveFrom = future.Add(2 * time.Hour)
	end2 := input.EffectiveFrom.Add(time.Hour)
	input.EffectiveTo = &end2
	statuses := make(chan string, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := app.CreatePrice(ctx, admin, domain.NewID(), input, ports.Meta{})
			statuses <- domain.Code(e)
		}()
	}
	wg.Wait()
	close(statuses)
	success, conflict := 0, 0
	for s := range statuses {
		if s == "" {
			success++
		}
		if s == "OVERLAPPING_PRICE_PERIOD" {
			conflict++
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("race %d success %d conflict", success, conflict)
	}
	// Database failure after the price insert must roll back domain + idempotency.
	before := 0
	_ = db.pool.QueryRow(ctx, "SELECT count(*) FROM price_versions").Scan(&before)
	if _, e = db.pool.Exec(ctx, "ALTER TABLE outbox ADD CONSTRAINT injected_failure CHECK (false) NOT VALID"); e != nil {
		t.Fatal(e)
	}
	input.EffectiveFrom = future.Add(5 * time.Hour)
	end3 := input.EffectiveFrom.Add(time.Hour)
	input.EffectiveTo = &end3
	_, e = app.CreatePrice(ctx, admin, domain.NewID(), input, ports.Meta{})
	if e == nil {
		t.Fatal("injected outbox failure was ignored")
	}
	_, _ = db.pool.Exec(ctx, "ALTER TABLE outbox DROP CONSTRAINT injected_failure")
	after := 0
	_ = db.pool.QueryRow(ctx, "SELECT count(*) FROM price_versions").Scan(&after)
	if after != before {
		t.Fatal("price persisted without its outbox event")
	}
	testHTTP(t, db)
	testMixedCaseIdempotency(t, db)
	if _, e = db.pool.Exec(ctx, "UPDATE user_access_projection SET capabilities='[]'::jsonb WHERE user_id=$1", admin.UserID); e != nil {
		t.Fatal(e)
	}
	if _, e = app.CreatePrice(ctx, admin, domain.NewID(), input, ports.Meta{}); domain.Code(e) != "FORBIDDEN" {
		t.Fatal("revoked privilege accepted", e)
	}
}
