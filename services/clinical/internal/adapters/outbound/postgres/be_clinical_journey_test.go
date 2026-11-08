//go:build integration

package postgres

import (
	"context"
	"encoding/json"
    "net/url"
    "os"
    "strings"
	"testing"
	"time"
	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

func TestRejectedLabRequiresRevisionedResubmit(t *testing.T) {
	db := isolatedJourneyDB(t)
	ctx := context.Background()
	app := usecase.New(db, time.Now)
	p, visit := reviewVisit(t, db, app)
	test := domain.NewID()
	if err := db.ImportCatalog(ctx, []CatalogImport{{Kind: "LAB_TEST", Entity: domain.CatalogEntity{ID: test, Code: test, Name: "CBC", Revision: 1, Status: "ACTIVE"}}}); err != nil {
		t.Fatal(err)
	}
	input := domain.LabInput{Tests: []domain.TestSelection{{TestID: test, Revision: 1}}}
	req, err := app.RequestLab(ctx, p, visit, domain.NewID(), input, domain.Meta{})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]any{"requestId": req.RequestID, "visitId": visit, "state": "REJECTED", "reasonCode": "INVALID_TEST", "version": 1})
	event := domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "LabOrderResolved", SchemaVersion: 1, Producer: "diagnostic", AggregateID: req.RequestID, AggregateVersion: 1, RequestID: req.RequestID, CausationID: domain.NewID(), CorrelationID: "resubmit", OccurredAt: time.Now(), Payload: payload}
	if err = app.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", event); err != nil {
		t.Fatal(err)
	}
	var version int
	if err = db.pool.QueryRow(ctx, `SELECT version FROM visits WHERE id=$1`, visit).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if _, err = app.Complete(ctx, p, visit, domain.NewID(), domain.VersionInput{ExpectedVersion: version}, domain.Meta{}); domain.Code(err) != "LAB_PENDING" {
		t.Fatalf("rejected LAB did not block sign: %v", err)
	}
	input.ReplacesRequestID = req.RequestID
	input.ExpectedSourceVersion = 2
	if _, err = app.RequestLab(ctx, p, visit, domain.NewID(), input, domain.Meta{}); domain.Code(err) != "STATE_CONFLICT" {
		t.Fatalf("stale replacement accepted: %v", err)
	}
	input.ExpectedSourceVersion = 1
	key := domain.NewID()
	next, err := app.RequestLab(ctx, p, visit, key, input, domain.Meta{})
	if err != nil {
		t.Fatal(err)
	}
	replay, err := app.RequestLab(ctx, p, visit, key, input, domain.Meta{})
	if err != nil || replay.RequestID != next.RequestID {
		t.Fatal("replacement not idempotent", err)
	}
	var state string
	var count int
	db.pool.QueryRow(ctx, `SELECT state FROM lab_requests WHERE request_id=$1`, req.RequestID).Scan(&state)
	db.pool.QueryRow(ctx, `SELECT count(*) FROM lab_requests WHERE visit_id=$1`, visit).Scan(&count)
	if state != "SUPERSEDED" || count != 2 {
		t.Fatalf("replacement registry state=%s count=%d", state, count)
	}
}


func isolatedJourneyDB(t *testing.T) *Probe {
    t.Helper()
    bootstrap := testDB(t) // validates the isolated database allowlist.
    schema := "journey_" + strings.ReplaceAll(domain.NewID(), "-", "")
    if _, err := bootstrap.pool.Exec(context.Background(), "CREATE SCHEMA "+schema); err != nil { t.Fatal(err) }
    u, err := url.Parse(os.Getenv("TEST_DATABASE_URL"))
    if err != nil { t.Fatal(err) }
    q := u.Query()
    q.Set("search_path",schema)
    u.RawQuery=q.Encode()
    db, err := New(context.Background(),u.String())
    if err != nil { t.Fatal(err) }
    t.Cleanup(db.Close)
    if err=db.Migrate(context.Background());err != nil {t.Fatal(err)}
    if _,err=db.pool.Exec(context.Background(),`UPDATE catalog_stream_state SET sequence=1,highest_observed=1,checkpoint_at=now() WHERE singleton=true`);err != nil {t.Fatal(err)}
    return db
}
