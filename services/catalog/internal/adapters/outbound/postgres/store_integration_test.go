//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"errors"
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

func identityChanged(messageID, userID string, version int64, status string) []byte {
	raw, _ := json.Marshal(map[string]any{
		"messageId": messageID, "messageKind": "EVENT", "messageType": "IdentityAccessChanged", "schemaVersion": 1,
		"producer": "identity", "aggregateId": userID, "aggregateVersion": version,
		"correlationId": "catalog-identity-test", "causationId": domain.NewID(), "requestId": domain.NewID(), "occurredAt": time.Now().UTC(),
		"payload": map[string]any{"userId": userID, "actorType": "STAFF", "status": status, "tokenVersion": version, "capabilities": []string{"ADMIN"}, "version": version},
	})
	return raw
}

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
	admin := domain.Principal{UserID: "00000000-0000-4000-8000-000000000901", ActorType: "STAFF", Capabilities: []string{"ADMIN"}, TokenVersion: 1, LeaseAction: "CA-004", LeaseExpiresAt: time.Now().Add(time.Hour)}
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
	testRevocationDuringItemLock(t, db)
	if _, e = db.pool.Exec(ctx, "UPDATE user_access_projection SET capabilities='[]'::jsonb WHERE user_id=$1", admin.UserID); e != nil {
		t.Fatal(e)
	}
	if _, e = app.CreatePrice(ctx, admin, domain.NewID(), input, ports.Meta{}); domain.Code(e) != "FORBIDDEN" {
		t.Fatal("revoked privilege accepted", e)
	}
}

func TestCatalogStreamBootstrapCheckpoint(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	u, e := url.Parse(dsn)
	if e != nil || !strings.HasPrefix(u.Path, "/umc_huy_test") {
		t.Fatal("integration requires isolated umc_huy_test database")
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
	if _, e = db.pool.Exec(ctx, `TRUNCATE outbox; UPDATE catalog_stream SET sequence=0,generation=0,bootstrap_completed_at=NULL,checkpoint_at=NULL WHERE singleton=true`); e != nil {
		t.Fatal(e)
	}
	if e = db.BootstrapCatalogStream(ctx); e != nil {
		t.Fatal(e)
	}
	var sequence int64
	var completed bool
	if e = db.pool.QueryRow(ctx, `SELECT sequence,bootstrap_completed_at IS NOT NULL FROM catalog_stream WHERE singleton=true`).Scan(&sequence, &completed); e != nil || !completed {
		t.Fatalf("bootstrap state sequence=%d complete=%v err=%v", sequence, completed, e)
	}
	var count int64
	var minimum, maximum int64
	if e = db.pool.QueryRow(ctx, `SELECT count(DISTINCT (payload->'payload'->>'streamSequence')::bigint),min((payload->'payload'->>'streamSequence')::bigint),max((payload->'payload'->>'streamSequence')::bigint) FROM outbox WHERE message_type='CatalogChanged' AND payload->'payload'->>'mode' IN ('UPSERT','TOMBSTONE')`).Scan(&count, &minimum, &maximum); e != nil {
		t.Fatal(e)
	}
	if count != sequence || (sequence > 0 && (minimum != 1 || maximum != sequence)) {
		t.Fatalf("Catalog stream has a gap: count=%d range=%d..%d sequence=%d", count, minimum, maximum, sequence)
	}
	var checkpoints int
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE message_type='CatalogChanged' AND payload->'payload'->>'mode'='CHECKPOINT'`).Scan(&checkpoints)
	if _, e = db.pool.Exec(ctx, `UPDATE catalog_stream SET checkpoint_at=NULL WHERE singleton=true`); e != nil {
		t.Fatal(e)
	}
	base := time.Now().UTC().Truncate(time.Microsecond)
	if e = db.EnsureCheckpoint(ctx, base); e != nil {
		t.Fatal(e)
	}
	var afterFirst int
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE message_type='CatalogChanged' AND payload->'payload'->>'mode'='CHECKPOINT'`).Scan(&afterFirst)
	if afterFirst != checkpoints+1 {
		t.Fatalf("first checkpoint count=%d previous=%d", afterFirst, checkpoints)
	}
	if e = db.EnsureCheckpoint(ctx, base.Add(9*time.Second)); e != nil {
		t.Fatal(e)
	}
	var afterNine int
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE message_type='CatalogChanged' AND payload->'payload'->>'mode'='CHECKPOINT'`).Scan(&afterNine)
	if afterNine != afterFirst {
		t.Fatal("checkpoint emitted before 10 seconds", afterNine, afterFirst)
	}
	if e = db.EnsureCheckpoint(ctx, base.Add(10*time.Second)); e != nil {
		t.Fatal(e)
	}
	var afterTen int
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE message_type='CatalogChanged' AND payload->'payload'->>'mode'='CHECKPOINT'`).Scan(&afterTen)
	if afterTen != afterFirst+1 {
		t.Fatal("10-second checkpoint not emitted", afterTen, afterFirst)
	}
	if e = db.BootstrapCatalogStream(ctx); e != nil {
		t.Fatal("bootstrap replay must be idempotent", e)
	}
	var finalSequence int64
	_ = db.pool.QueryRow(ctx, `SELECT sequence FROM catalog_stream WHERE singleton=true`).Scan(&finalSequence)
	if finalSequence != sequence {
		t.Fatal("repeated bootstrap changed watermark", finalSequence, sequence)
	}

	// Bootstrap inserts share transaction timestamps. UUID order must never reorder
	// their stream sequence or send a checkpoint ahead of its covered entities.
	if _, e = db.pool.Exec(ctx, `DELETE FROM outbox WHERE message_type='CatalogChanged' AND payload->'payload'->>'mode'='CHECKPOINT' AND message_id NOT IN (SELECT message_id FROM outbox WHERE message_type='CatalogChanged' AND payload->'payload'->>'mode'='CHECKPOINT' ORDER BY created_at LIMIT 1)`); e != nil {
		t.Fatal(e)
	}
	if _, e = db.pool.Exec(ctx, `UPDATE outbox SET status='PENDING',created_at='2000-01-01',next_attempt_at=now(),message_id=('00000000-0000-4000-8000-' || lpad((100000-((payload->'payload'->>'streamSequence')::bigint)*10-CASE WHEN payload->'payload'->>'mode'='CHECKPOINT' THEN 1 ELSE 0 END)::text,12,'0'))::uuid WHERE message_type='CatalogChanged'`); e != nil {
		t.Fatal(e)
	}
	var previous int64
	checkpointSeen := false
	for {
		sent, err := db.PublishPending(ctx, func(_ context.Context, message ports.Outgoing) error {
			var envelope struct {
				Payload struct {
					Sequence int64  `json:"streamSequence"`
					Mode     string `json:"mode"`
				} `json:"payload"`
			}
			if err := json.Unmarshal(message.Body, &envelope); err != nil {
				return err
			}
			current := envelope.Payload.Sequence
			if current < previous || (current == previous && checkpointSeen && envelope.Payload.Mode != "CHECKPOINT") {
				t.Fatalf("outbox reordered stream: previous=%d checkpoint=%v next=%d mode=%s", previous, checkpointSeen, current, envelope.Payload.Mode)
			}
			if current != previous {
				checkpointSeen = false
			}
			previous = current
			checkpointSeen = checkpointSeen || envelope.Payload.Mode == "CHECKPOINT"
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if !sent {
			break
		}
	}
}

func TestCatalogOutboxAndIdentityProjection(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	u, err := url.Parse(dsn)
	if err != nil || !strings.HasPrefix(u.Path, "/umc_huy_test") {
		t.Fatal("integration requires isolated umc_huy_test database")
	}
	ctx := context.Background()
	db, err := New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = db.Seed(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = db.pool.Exec(ctx, `TRUNCATE outbox; UPDATE catalog_stream SET sequence=0,generation=0,bootstrap_completed_at=NULL,checkpoint_at=NULL WHERE singleton=true`); err != nil {
		t.Fatal(err)
	}
	if err = db.BootstrapCatalogStream(ctx); err != nil {
		t.Fatal(err)
	}

	if sent, e := db.PublishPending(ctx, func(context.Context, ports.Outgoing) error { return errors.New("mandatory return") }); e != nil || sent {
		t.Fatalf("failed publish result sent=%v err=%v", sent, e)
	}
	var pending, retries int
	if err = db.pool.QueryRow(ctx, `SELECT count(*) FILTER(WHERE status='PENDING'),max(retry_count) FROM outbox`).Scan(&pending, &retries); err != nil || pending < 1 || retries != 1 {
		t.Fatalf("returned publish did not stay pending: pending=%d retries=%d err=%v", pending, retries, err)
	}
	if _, err = db.pool.Exec(ctx, `UPDATE outbox SET next_attempt_at=now() WHERE status='PENDING'`); err != nil {
		t.Fatal(err)
	}
	if sent, e := db.PublishPending(ctx, func(_ context.Context, outgoing ports.Outgoing) error {
		if outgoing.Exchange != "umc.events.catalog.v1" || outgoing.RoutingKey != "catalog.catalog-changed.v1" || !domain.ValidID(outgoing.MessageID) || len(outgoing.Body) == 0 {
			return errors.New("invalid outgoing Catalog event")
		}
		return nil
	}); e != nil || !sent {
		t.Fatalf("confirmed publish result sent=%v err=%v", sent, e)
	}
	var sentCount int
	if err = db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE status='SENT' AND sent_at IS NOT NULL`).Scan(&sentCount); err != nil || sentCount != 1 {
		t.Fatalf("confirmed row was not marked sent: %d %v", sentCount, err)
	}

	userID := domain.NewID()
	firstID := domain.NewID()
	first := identityChanged(firstID, userID, 2, "ACTIVE")
	if err = db.ApplyIdentityAccessChanged(ctx, "umc.events.identity.v1", "identity.identity-access-changed.v1", firstID, first); err != nil {
		t.Fatal(err)
	}
	if err = db.ApplyIdentityAccessChanged(ctx, "umc.events.identity.v1", "identity.identity-access-changed.v1", firstID, first); err != nil {
		t.Fatal("duplicate delivery", err)
	}
	if err = db.ApplyIdentityAccessChanged(ctx, "umc.events.identity.v1", "identity.identity-access-changed.v1", domain.NewID(), identityChanged(domain.NewID(), userID, 2, "ACTIVE")); domain.Code(err) != "INVALID_MESSAGE" {
		t.Fatal("delivery identity mismatch accepted", err)
	}
	semanticID := domain.NewID()
	if err = db.ApplyIdentityAccessChanged(ctx, "umc.events.identity.v1", "identity.identity-access-changed.v1", semanticID, identityChanged(semanticID, userID, 2, "ACTIVE")); err != nil {
		t.Fatal("same semantic version rejected", err)
	}
	staleID := domain.NewID()
	if err = db.ApplyIdentityAccessChanged(ctx, "umc.events.identity.v1", "identity.identity-access-changed.v1", staleID, identityChanged(staleID, userID, 1, "SUSPENDED")); err != nil {
		t.Fatal("stale delivery should be acknowledged", err)
	}
	var status string
	var sourceVersion int64
	if err = db.pool.QueryRow(ctx, `SELECT status,source_version FROM user_access_projection WHERE user_id=$1`, userID).Scan(&status, &sourceVersion); err != nil || status != "ACTIVE" || sourceVersion != 2 {
		t.Fatalf("stale event moved projection backwards: %s v%d err=%v", status, sourceVersion, err)
	}
	conflictID := domain.NewID()
	if err = db.ApplyIdentityAccessChanged(ctx, "umc.events.identity.v1", "identity.identity-access-changed.v1", conflictID, identityChanged(conflictID, userID, 2, "SUSPENDED")); domain.Code(err) != "STATE_CONFLICT" {
		t.Fatal("same-version conflicting projection accepted", err)
	}
}
