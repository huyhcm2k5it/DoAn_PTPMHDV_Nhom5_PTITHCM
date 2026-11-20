//go:build integration

package postgres

import (
	"context"
	"testing"
	"time"

	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

func TestRevokedVisitBlocksDoctorReadsWritesAndReplay(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	seedAccess(t, db)
	app := usecase.New(db, time.Now)
	doctor := domain.Principal{UserID: doctorUser, ActorType: "DOCTOR", TokenVersion: 1}
	ticket := seedTicket(t, db, "FIRST", "")
	start, err := app.Start(ctx, doctor, domain.NewID(), domain.StartInput{TicketID: ticket.ID, DoctorID: ticket.DoctorID, ExpectedTicketVersion: 1}, domain.Meta{})
	if err != nil {
		t.Fatal(err)
	}
	if err = app.HandleClaim(ctx, "umc.events.appointment.v1", claimFor(ticket, start, "ACCEPTED")); err != nil {
		t.Fatal(err)
	}
	var visit string
	if err = db.pool.QueryRow(ctx, "SELECT visit_id::text FROM start_requests WHERE request_id=$1", start.RequestID).Scan(&visit); err != nil {
		t.Fatal(err)
	}
	text := "verified note"
	draft := domain.DraftInput{Symptoms: &text, Findings: &text, Assessment: &text, Diagnosis: &text, ExpectedVersion: 1}
	draftKey := domain.NewID()
	if _, err = app.SaveDraft(ctx, doctor, visit, draftKey, draft); err != nil {
		t.Fatal(err)
	}
	code := domain.NewID()
	if _, err = db.pool.Exec(ctx, `INSERT INTO catalog_entity_projection(entity_type,entity_id,code,name,revision,status)
		VALUES('MEDICINE',$1,$2,'Trusted medicine',1,'ACTIVE')`, domain.NewID(), code); err != nil {
		t.Fatal(err)
	}
	rxInput := domain.PrescriptionInput{Lines: []domain.PrescriptionLine{{MedicineCode: code, DoseText: "one", Quantity: 1}}}
	rxKey := domain.NewID()
	rx, err := app.CreatePrescription(ctx, doctor, visit, rxKey, rxInput)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.pool.Exec(ctx, "DELETE FROM visit_doctor_grants WHERE visit_id=$1", visit); err != nil {
		t.Fatal(err)
	}
	if _, err = app.Detail(ctx, doctor, visit); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("missing authority must fail closed: %v", err)
	}
	if err = db.ReconcileVisitGrant(ctx, visit, true, time.Now()); err != nil {
		t.Fatal(err)
	}
	var before int
	if err = db.pool.QueryRow(ctx, "SELECT count(*) FROM outbox").Scan(&before); err != nil {
		t.Fatal(err)
	}
	run := func(action string) domain.Principal {
		p := doctor
		p.LeaseAction, p.LeaseExpiresAt = action, time.Now().Add(time.Minute)
		return p
	}
	cases := map[string]func() error{
		"detail": func() error { _, e := app.Detail(ctx, doctor, visit); return e },
		"draft": func() error {
			in := draft
			in.ExpectedVersion = 2
			_, e := app.SaveDraft(ctx, doctor, visit, domain.NewID(), in)
			return e
		},
		"draft replay": func() error { _, e := app.SaveDraft(ctx, doctor, visit, draftKey, draft); return e },
		"LAB": func() error {
			_, e := app.RequestLab(ctx, doctor, visit, domain.NewID(), domain.LabInput{Tests: []domain.TestSelection{{TestID: domain.NewID(), Revision: 1}}}, domain.Meta{})
			return e
		},
		"create prescription": func() error { _, e := app.CreatePrescription(ctx, doctor, visit, domain.NewID(), rxInput); return e },
		"create replay":       func() error { _, e := app.CreatePrescription(ctx, doctor, visit, rxKey, rxInput); return e },
		"update prescription": func() error {
			in := rxInput
			in.ExpectedVersion = rx.Version
			_, e := app.UpdatePrescription(ctx, doctor, rx.ID, domain.NewID(), in)
			return e
		},
		"delete prescription": func() error {
			_, e := app.DeletePrescription(ctx, doctor, rx.ID, domain.NewID(), domain.VersionInput{ExpectedVersion: rx.Version})
			return e
		},
		"finalize": func() error {
			_, e := app.FinalizePrescription(ctx, run("CL-009"), rx.ID, domain.NewID(), domain.VersionInput{ExpectedVersion: rx.Version}, domain.Meta{})
			return e
		},
		"complete": func() error {
			_, e := app.Complete(ctx, run("CL-010"), visit, domain.NewID(), domain.VersionInput{ExpectedVersion: 2}, domain.Meta{})
			return e
		},
	}
	for name, call := range cases {
		t.Run(name, func(t *testing.T) {
			if e := call(); domain.Code(e) != "FORBIDDEN" {
				t.Fatalf("revoked operation returned %v", e)
			}
		})
	}
	worklist, err := app.Worklist(ctx, doctor, domain.WorklistQuery{Page: 1, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range worklist.Items {
		if item.ID == visit {
			t.Fatal("revoked visit remained in doctor worklist")
		}
	}
	returnTicket := seedTicket(t, db, "RETURN", visit)
	if _, err = app.Start(ctx, doctor, domain.NewID(), domain.StartInput{TicketID: returnTicket.ID, DoctorID: returnTicket.DoctorID, ExpectedTicketVersion: 1}, domain.Meta{}); domain.Code(err) != "FORBIDDEN" {
		t.Fatalf("revoked visit accepted a new RETURN claim: %v", err)
	}
	var after, notes, version int
	if err = db.pool.QueryRow(ctx, "SELECT count(*) FROM outbox").Scan(&after); err != nil {
		t.Fatal(err)
	}
	if err = db.pool.QueryRow(ctx, "SELECT count(*) FROM visit_notes WHERE visit_id=$1", visit).Scan(&notes); err != nil {
		t.Fatal(err)
	}
	if err = db.pool.QueryRow(ctx, "SELECT version FROM visits WHERE id=$1", visit).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if before != after || notes != 1 || version != 2 {
		t.Fatalf("revoked requests changed data: outbox=%d/%d notes=%d version=%d", before, after, notes, version)
	}
}
