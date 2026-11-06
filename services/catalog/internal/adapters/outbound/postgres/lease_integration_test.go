//go:build integration

package postgres

import (
	"context"
	"testing"
	"time"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/application/usecase"
	"umccare/catalog/internal/domain"
)

func testRevocationDuringItemLock(t *testing.T, db *Store) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	user := domain.NewID()
	if _, err := db.pool.Exec(ctx, `INSERT INTO user_access_projection(user_id,actor_type,capabilities,token_version,status) VALUES($1,'STAFF','["ADMIN"]',1,'ACTIVE')`, user); err != nil {
		t.Fatal(err)
	}
	blocker, err := db.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback(context.Background())
	item := "00000000-0000-4000-8000-000000000201"
	if _, err = blocker.Exec(ctx, "SELECT id FROM medical_services WHERE id=$1 FOR UPDATE", item); err != nil {
		t.Fatal(err)
	}
	p := domain.Principal{UserID: user, ActorType: "STAFF", Capabilities: []string{"ADMIN"}, TokenVersion: 1, LeaseAction: "CA-004", LeaseExpiresAt: time.Now().Add(time.Minute)}
	input := domain.PriceInput{ItemType: "EXAM", ItemID: item, AmountVND: 777, EffectiveFrom: time.Now().UTC().Add(90 * 24 * time.Hour).Truncate(time.Second)}
	done := make(chan error, 1)
	go func() {
		_, e := usecase.New(db, db, ports.RealClock{}).CreatePrice(ctx, p, domain.NewID(), input, ports.Meta{})
		done <- e
	}()
	deadline := time.Now().Add(4 * time.Second)
	for {
		var waiting int
		if err = db.pool.QueryRow(ctx, "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND state='active'").Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("price request did not wait for the item lock")
		}
		time.Sleep(5 * time.Millisecond)
	}
	updateCtx, stop := context.WithTimeout(ctx, time.Second)
	_, err = db.pool.Exec(updateCtx, "UPDATE user_access_projection SET status='INACTIVE' WHERE user_id=$1", user)
	stop()
	if err != nil {
		t.Fatalf("revocation could not be applied while item was locked: %v", err)
	}
	if err = blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = <-done; domain.Code(err) != "FORBIDDEN" {
		t.Fatalf("revoked administrator committed a price: %v", err)
	}
}
