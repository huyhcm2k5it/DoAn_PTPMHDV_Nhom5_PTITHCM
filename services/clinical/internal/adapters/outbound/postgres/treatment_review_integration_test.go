//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"
	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

func reviewVisit(t *testing.T, db *Probe, app *usecase.Service) (domain.Principal, string) {
	t.Helper()
	ctx := context.Background()
	seedAccess(t, db)
	p := domain.Principal{UserID: doctorUser, ActorType: "DOCTOR", TokenVersion: 1, LeaseAction: "CL-010", LeaseExpiresAt: time.Now().Add(time.Minute)}
	ticket := seedTicket(t, db, "FIRST", "")
	started, e := app.Start(ctx, p, domain.NewID(), domain.StartInput{TicketID: ticket.ID, DoctorID: doctorID, ExpectedTicketVersion: 1}, domain.Meta{})
	if e != nil {
		t.Fatal(e)
	}
	if e = app.HandleClaim(ctx, "umc.events.appointment.v1", claimFor(ticket, started, "ACCEPTED")); e != nil {
		t.Fatal(e)
	}
	var id string
	if e = db.pool.QueryRow(ctx, `SELECT visit_id::text FROM start_requests WHERE request_id=$1`, started.RequestID).Scan(&id); e != nil {
		t.Fatal(e)
	}
	txt := "diagnosis"
	if _, e = app.SaveDraft(ctx, p, id, domain.NewID(), domain.DraftInput{Symptoms: &txt, Findings: &txt, Assessment: &txt, Diagnosis: &txt, ExpectedVersion: 1}); e != nil {
		t.Fatal(e)
	}
	return p, id
}

func TestSigningLeaseRecheckedAfterVisitLock(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	base := time.Now()
	var nanos atomic.Int64
	nanos.Store(base.UnixNano())
	app := usecase.New(db, func() time.Time { return time.Unix(0, nanos.Load()) })
	p, id := reviewVisit(t, db, app)
	p.LeaseExpiresAt = base.Add(time.Second)
	lock, e := db.pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer lock.Rollback(ctx)
	if _, e = lock.Exec(ctx, `SELECT id FROM visits WHERE id=$1 FOR UPDATE`, id); e != nil {
		t.Fatal(e)
	}
	done := make(chan error, 1)
	go func() {
		_, e := app.Complete(ctx, p, id, domain.NewID(), domain.VersionInput{ExpectedVersion: 2}, domain.Meta{})
		done <- e
	}()
	// Observe the database wait, so the regression proves expiry after the
	// request passed its initial lease check, rather than a scheduling delay.
	deadline := time.Now().Add(5 * time.Second)
	for {
		var waiting bool
		if e = db.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM visits WHERE id=%')`).Scan(&waiting); e != nil {
			t.Fatal(e)
		}
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("signer never reached the visit row lock")
		}
		time.Sleep(10 * time.Millisecond)
	}
	nanos.Store(base.Add(2 * time.Second).UnixNano())
	if e = lock.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	if e = <-done; domain.Code(e) != "AUTHZ_LEASE_EXPIRED" {
		t.Fatalf("expired lease signed after row wait: %v", e)
	}
	var state string
	db.pool.QueryRow(ctx, `SELECT state FROM visits WHERE id=$1`, id).Scan(&state)
	if state == "SIGNED" {
		t.Fatal("expired lease changed visit")
	}
}

func TestLabResolutionEnvelopeBinding(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	app := usecase.New(db, time.Now)
	p, id := reviewVisit(t, db, app)
	test := domain.NewID()
	if e := db.ImportCatalog(ctx, []CatalogImport{{Kind: "LAB_TEST", Entity: domain.CatalogEntity{ID: test, Code: test, Name: "CBC", Revision: 1, Status: "ACTIVE"}}}); e != nil {
		t.Fatal(e)
	}
	req, e := app.RequestLab(ctx, p, id, domain.NewID(), domain.LabInput{Tests: []domain.TestSelection{{TestID: test, Revision: 1}}}, domain.Meta{})
	if e != nil {
		t.Fatal(e)
	}
	payload, _ := json.Marshal(map[string]any{"requestId": req.RequestID, "visitId": id, "state": "REJECTED", "reasonCode": "INVALID_TEST", "version": 1})
	m := domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "LabOrderResolved", SchemaVersion: 1, Producer: "diagnostic", AggregateID: domain.NewID(), AggregateVersion: 1, RequestID: req.RequestID, CausationID: domain.NewID(), CorrelationID: "review", OccurredAt: time.Now(), Payload: payload}
	if e = app.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", m); domain.Code(e) != "INVALID_MESSAGE" {
		t.Fatalf("foreign aggregate resolved registry: %v", e)
	}
	m.AggregateID = req.RequestID
	m.MessageID = domain.NewID()
	m.AggregateVersion = 2
	if e = app.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", m); domain.Code(e) != "INVALID_MESSAGE" {
		t.Fatalf("wrong version resolved registry: %v", e)
	}
	m.AggregateVersion = 1
	m.MessageID = domain.NewID()
	if e = app.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", m); e != nil {
		t.Fatal(e)
	}
	payload, _ = json.Marshal(map[string]any{"requestId": req.RequestID, "visitId": id, "state": "REJECTED", "reasonCode": "OTHER", "version": 1})
	m.Payload = payload
	m.MessageID = domain.NewID()
	if e = app.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", m); domain.Code(e) != "STATE_CONFLICT" {
		t.Fatalf("terminal reason overwritten: %v", e)
	}
}
