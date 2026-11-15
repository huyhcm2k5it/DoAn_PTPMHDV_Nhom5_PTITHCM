//go:build integration

package postgres

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"umccare/catalog/internal/domain"
)

func TestConcurrentFirstIdentityProjectionRejectsConflictingVersion(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	u, err := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	if err != nil || u == nil || !strings.HasPrefix(u.Path, "/umc_huy_test") {
		t.Fatal("isolated umc_huy_test database required")
	}
	admin, err := New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := pgx.Identifier{"identity_race_" + strings.ReplaceAll(domain.NewID(), "-", "")}.Sanitize()
	if _, err = admin.pool.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.pool.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	q := u.Query()
	q.Set("search_path", strings.Trim(schema, `"`))
	u.RawQuery = q.Encode()
	db, err := New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	// Pause both first inserts after their initial SELECT sees no projection.
	// With aggregate serialization, the second request waits before its SELECT.
	_, err = db.pool.Exec(ctx, `CREATE FUNCTION pause_identity_insert() RETURNS trigger LANGUAGE plpgsql AS $$
	BEGIN PERFORM pg_advisory_xact_lock(74001991); RETURN NEW; END $$;
	CREATE TRIGGER pause_identity_insert BEFORE INSERT ON user_access_projection
	FOR EACH ROW EXECUTE FUNCTION pause_identity_insert()`)
	if err != nil {
		t.Fatal(err)
	}
	gate, err := db.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer gate.Rollback(context.Background())
	if _, err = gate.Exec(ctx, "SELECT pg_advisory_xact_lock(74001991)"); err != nil {
		t.Fatal(err)
	}
	user := domain.NewID()
	errs := make(chan error, 2)
	for _, status := range []string{"ACTIVE", "SUSPENDED"} {
		id := domain.NewID()
		raw := identityChanged(id, user, 1, status)
		go func() {
			errs <- db.ApplyIdentityAccessChanged(ctx, "umc.events.identity.v1", "identity.identity-access-changed.v1", id, raw)
		}()
	}
	waiting := 0
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if err = db.pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock%'`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		// The pre-fix requests block inside INSERT, not a top-level lock query.
		var inserts int
		if err = db.pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock' AND query LIKE 'INSERT INTO user_access_projection%'`).Scan(&inserts); err != nil {
			t.Fatal(err)
		}
		waiting += inserts
		if waiting >= 2 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err = gate.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if waiting < 2 {
		t.Fatal("identity requests did not reach concurrency barrier")
	}
	success, conflict := 0, 0
	for i := 0; i < 2; i++ {
		err := <-errs
		if err == nil {
			success++
		} else if domain.Code(err) == "STATE_CONFLICT" {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("same Identity version with different content must conflict: success=%d conflict=%d", success, conflict)
	}
	var receipts int
	if err = db.pool.QueryRow(ctx, "SELECT count(*) FROM inbox").Scan(&receipts); err != nil || receipts != 1 {
		t.Fatalf("conflicting event was acknowledged: inbox=%d err=%v", receipts, err)
	}
}
