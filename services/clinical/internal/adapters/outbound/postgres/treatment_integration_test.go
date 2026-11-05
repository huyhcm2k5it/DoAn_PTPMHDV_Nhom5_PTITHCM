//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"
	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

func TestTreatmentEndToEnd(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	seedAccess(t, db)
	s := usecase.New(db, time.Now)
	p := domain.Principal{UserID: doctorUser, ActorType: "DOCTOR", TokenVersion: 1, LeaseExpiresAt: time.Now().Add(time.Minute), LeaseAction: "CL-010"}
	ticket := seedTicket(t, db, "FIRST", "")
	start, e := s.Start(ctx, p, domain.NewID(), domain.StartInput{TicketID: ticket.ID, DoctorID: ticket.DoctorID, ExpectedTicketVersion: 1}, domain.Meta{})
	if e != nil {
		t.Fatal(e)
	}
	if e = s.HandleClaim(ctx, "umc.events.appointment.v1", claimFor(ticket, start, "ACCEPTED")); e != nil {
		t.Fatal(e)
	}
	var visit string
	if e = db.pool.QueryRow(ctx, `SELECT visit_id::text FROM start_requests WHERE request_id=$1`, start.RequestID).Scan(&visit); e != nil {
		t.Fatal(e)
	}
	_, e = db.pool.Exec(ctx, `INSERT INTO catalog_entity_projection(entity_type,entity_id,code,name,revision,status)VALUES('MEDICINE',$1,$2,'Trusted medicine',1,'ACTIVE')`, domain.NewID(), visit)
	if e != nil {
		t.Fatal(e)
	}
	lines := domain.PrescriptionInput{Lines: []domain.PrescriptionLine{{MedicineCode: visit, NameSnapshot: "forged", DoseText: "one", Quantity: 2}}}
	rx, e := s.CreatePrescription(ctx, p, visit, domain.NewID(), lines)
	if e != nil || rx.Lines[0].NameSnapshot != "Trusted medicine" {
		t.Fatal(rx, e)
	}
	p.LeaseAction = "CL-009"
	if _, e = s.FinalizePrescription(ctx, p, rx.ID, domain.NewID(), domain.VersionInput{ExpectedVersion: 1}, domain.Meta{}); domain.Code(e) != "STATE_CONFLICT" {
		t.Fatal("finalized unsigned", e)
	}
	txt := "diagnosis"
	if _, e = s.SaveDraft(ctx, p, visit, domain.NewID(), domain.DraftInput{Symptoms: &txt, Findings: &txt, Assessment: &txt, Diagnosis: &txt, ExpectedVersion: 1}); e != nil {
		t.Fatal(e)
	}
	key := domain.NewID()
	p.LeaseAction = "CL-010"
	signed, e := s.Complete(ctx, p, visit, key, domain.VersionInput{ExpectedVersion: 2}, domain.Meta{})
	if e != nil || signed.State != "SIGNED" {
		t.Fatal(signed, e)
	}
	if _, e = s.Complete(ctx, p, visit, key, domain.VersionInput{ExpectedVersion: 2}, domain.Meta{}); e != nil {
		t.Fatal(e)
	}
	p.LeaseAction = "CL-009"
	rx, e = s.FinalizePrescription(ctx, p, rx.ID, domain.NewID(), domain.VersionInput{ExpectedVersion: 1}, domain.Meta{})
	if e != nil || rx.State != "FINAL" {
		t.Fatal(rx, e)
	}
	if _, e = s.UpdatePrescription(ctx, p, rx.ID, domain.NewID(), domain.PrescriptionInput{Lines: lines.Lines, ExpectedVersion: rx.Version}); domain.Code(e) != "STATE_CONFLICT" {
		t.Fatal("final mutated", e)
	}
	var count int
	if e = db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE aggregate_id=$1 AND envelope->>'messageType'='VisitSigned'`, visit).Scan(&count); e != nil || count != 1 {
		t.Fatal(count, e)
	}
	patient := domain.Principal{UserID: patientUser, ActorType: "PATIENT", TokenVersion: 1}
	detail, e := s.Detail(ctx, patient, visit)
	if e != nil || len(detail.Prescriptions) != 1 || len(detail.LabRequests) != 0 {
		t.Fatal(detail, e)
	}
	raw, _ := json.Marshal(detail)
	if len(raw) == 0 {
		t.Fatal("no detail")
	}
}

func TestCompleteVsLabRequestSerialized(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	seedAccess(t, db)
	s := usecase.New(db, time.Now)
	p := domain.Principal{UserID: doctorUser, ActorType: "DOCTOR", TokenVersion: 1, LeaseExpiresAt: time.Now().Add(time.Minute), LeaseAction: "CL-010"}
	ticket := seedTicket(t, db, "FIRST", "")
	start, e := s.Start(ctx, p, domain.NewID(), domain.StartInput{TicketID: ticket.ID, DoctorID: ticket.DoctorID, ExpectedTicketVersion: 1}, domain.Meta{})
	if e != nil {
		t.Fatal(e)
	}
	if e = s.HandleClaim(ctx, "umc.events.appointment.v1", claimFor(ticket, start, "ACCEPTED")); e != nil {
		t.Fatal(e)
	}
	var id string
	db.pool.QueryRow(ctx, `SELECT visit_id::text FROM start_requests WHERE request_id=$1`, start.RequestID).Scan(&id)
	txt := "d"
	_, e = s.SaveDraft(ctx, p, id, domain.NewID(), domain.DraftInput{Symptoms: &txt, Findings: &txt, Assessment: &txt, Diagnosis: &txt, ExpectedVersion: 1})
	if e != nil {
		t.Fatal(e)
	}
	test := domain.NewID()
	_, e = db.pool.Exec(ctx, `INSERT INTO catalog_entity_projection(entity_type,entity_id,code,name,revision,status)VALUES('LAB_TEST',$1,$2,'CBC',1,'ACTIVE')`, test, test)
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	wg.Add(2)
	errs := make(chan error, 2)
	go func() {
		defer wg.Done()
		_, e := s.Complete(ctx, p, id, domain.NewID(), domain.VersionInput{ExpectedVersion: 2}, domain.Meta{})
		errs <- e
	}()
	go func() {
		defer wg.Done()
		_, e := s.RequestLab(ctx, p, id, domain.NewID(), domain.LabInput{Tests: []domain.TestSelection{{TestID: test, Revision: 1}}}, domain.Meta{})
		errs <- e
	}()
	wg.Wait()
	close(errs)
	success := 0
	for e := range errs {
		if e == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatal("expected one winner", success)
	}
	var state string
	var pending int
	db.pool.QueryRow(ctx, `SELECT state FROM visits WHERE id=$1`, id).Scan(&state)
	db.pool.QueryRow(ctx, `SELECT count(*) FROM lab_requests WHERE visit_id=$1`, id).Scan(&pending)
	if state == "SIGNED" && pending > 0 {
		t.Fatal("signed with pending LAB")
	}
}

func TestMultipleLabRequestsAndResolution(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	seedAccess(t, db)
	s := usecase.New(db, time.Now)
	p := domain.Principal{UserID: doctorUser, ActorType: "DOCTOR", TokenVersion: 1, LeaseExpiresAt: time.Now().Add(time.Minute), LeaseAction: "CL-010"}
	ticket := seedTicket(t, db, "FIRST", "")
	started, e := s.Start(ctx, p, domain.NewID(), domain.StartInput{TicketID: ticket.ID, DoctorID: doctorID, ExpectedTicketVersion: 1}, domain.Meta{})
	if e != nil {
		t.Fatal(e)
	}
	if e = s.HandleClaim(ctx, "umc.events.appointment.v1", claimFor(ticket, started, "ACCEPTED")); e != nil {
		t.Fatal(e)
	}
	var id string
	if e = db.pool.QueryRow(ctx, `SELECT visit_id::text FROM start_requests WHERE request_id=$1`, started.RequestID).Scan(&id); e != nil {
		t.Fatal(e)
	}
	var requests []domain.LabPending
	for i := 0; i < 2; i++ {
		test := domain.NewID()
		if e = db.ImportCatalog(ctx, []CatalogImport{{Kind: "LAB_TEST", Entity: domain.CatalogEntity{ID: test, Code: test, Name: "CBC", Revision: 1, Status: "ACTIVE"}}}); e != nil {
			t.Fatal(e)
		}
		input := domain.LabInput{Tests: []domain.TestSelection{{TestID: test, Revision: 1}}}
		r, e := s.RequestLab(ctx, p, id, domain.NewID(), input, domain.Meta{})
		if e != nil {
			t.Fatal("multiple LAB request", i, e)
		}
		requests = append(requests, r)
		if _, e = s.RequestLab(ctx, p, id, domain.NewID(), input, domain.Meta{}); domain.Code(e) != "LAB_REQUEST_DUPLICATE" {
			t.Fatal("duplicate business request", e)
		}
	}
	for i, r := range requests {
		payload, _ := json.Marshal(map[string]any{"requestId": r.RequestID, "visitId": id, "state": "CREATED", "orderId": domain.NewID(), "reasonCode": "", "version": 1})
		m := domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "LabOrderResolved", SchemaVersion: 1, Producer: "diagnostic", AggregateID: r.RequestID, AggregateVersion: 1, CorrelationID: "test", CausationID: domain.NewID(), RequestID: r.RequestID, OccurredAt: time.Now(), Payload: payload}
		if e = s.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", m); e != nil {
			t.Fatal(e)
		}
		if e = s.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", m); e != nil {
			t.Fatal("duplicate resolution", e)
		}
		detail, e := s.Detail(ctx, p, id)
		if e != nil {
			t.Fatal(e)
		}
		expected := "LAB_REQUEST_PENDING"
		if i == 1 {
			expected = "WAITING_LAB"
		}
		if detail.Visit.State != expected {
			t.Fatal(detail.Visit.State, expected)
		}
	}
}
