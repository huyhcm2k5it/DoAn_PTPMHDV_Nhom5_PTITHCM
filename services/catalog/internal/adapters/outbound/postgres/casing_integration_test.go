//go:build integration

package postgres

import (
	"context"
	"strings"
	"testing"
	"time"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/application/usecase"
	"umccare/catalog/internal/domain"
)

func testMixedCaseIdempotency(t *testing.T, db *Store) {
	t.Helper()
	ctx := context.Background()
	user := "aaaaaaaa-aaaa-4aaa-8aaa-000000000901"
	_, err := db.pool.Exec(ctx, `INSERT INTO user_access_projection(user_id,actor_type,capabilities,token_version,status) VALUES($1,'STAFF','["ADMIN"]',1,'ACTIVE')`, user)
	if err != nil {
		t.Fatal(err)
	}
	app := usecase.New(db, db, ports.RealClock{})
	for index, which := range []string{"key", "actor", "different-body"} {
		t.Run("mixed-case-"+which, func(t *testing.T) {
			blocker, e := db.pool.Begin(ctx)
			if e != nil {
				t.Fatal(e)
			}
			defer blocker.Rollback(ctx)
			if _, e = blocker.Exec(ctx, "SELECT id FROM medical_services FOR UPDATE"); e != nil {
				t.Fatal(e)
			}
			from := time.Now().UTC().Add(time.Duration(50+index) * 24 * time.Hour).Truncate(time.Second)
			to := from.Add(time.Hour)
			input := domain.PriceInput{ItemType: "EXAM", ItemID: "00000000-0000-4000-8000-000000000201", AmountVND: 150000, EffectiveFrom: from, EffectiveTo: &to}
			key := domain.NewID()
			results := make(chan error, 2)
			for i := 0; i < 2; i++ {
				p := domain.Principal{UserID: user, ActorType: "STAFF", Capabilities: []string{"ADMIN"}, TokenVersion: 1, LeaseAction: "CA-004"}
				k := key
				in := input
				if i == 1 {
					if which == "actor" {
						p.UserID = strings.ToUpper(p.UserID)
					} else {
						k = strings.ToUpper(k)
					}
					if which == "different-body" {
						in.ItemID = "00000000-0000-4000-8000-000000000202"
					}
				}
				go func() { _, e := app.CreatePrice(ctx, p, k, in, ports.Meta{}); results <- e }()
			}
			// Both requests must be waiting on our row lock or the idempotency lock.
			deadline := time.Now().Add(4 * time.Second)
			waiting := 0
			for time.Now().Before(deadline) {
				e = db.pool.QueryRow(ctx, "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock'").Scan(&waiting)
				if e != nil {
					t.Fatal(e)
				}
				if waiting >= 2 {
					break
				}
				time.Sleep(5 * time.Millisecond)
			}
			if e = blocker.Commit(ctx); e != nil {
				t.Fatal(e)
			}
			if waiting < 2 {
				t.Fatal("requests did not reach the deterministic concurrency barrier")
			}
			success, conflict := 0, 0
			for i := 0; i < 2; i++ {
				err := <-results
				if err == nil {
					success++
				} else if domain.Code(err) == "IDEMPOTENCY_CONFLICT" {
					conflict++
				} else {
					t.Fatalf("UUID aliases bypassed serialization: %v", err)
				}
			}
			if which == "different-body" {
				if success != 1 || conflict != 1 {
					t.Fatalf("expected one creation and one idempotency conflict, got %d/%d", success, conflict)
				}
			} else if success != 2 {
				t.Fatalf("equivalent UUIDs must both replay successfully, success=%d", success)
			}
		})
	}
}
