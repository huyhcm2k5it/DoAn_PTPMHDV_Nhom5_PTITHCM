//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

const doctorUser = "11111111-0000-0000-0000-000000000001"
const otherDoctor = "11111111-0000-0000-0000-000000000002"
const patientUser = "11111111-0000-0000-0000-000000000003"
const doctorID = "22222222-0000-0000-0000-000000000001"
const patientID = "33333333-0000-0000-0000-000000000001"
const departmentID = "44444444-0000-0000-0000-000000000001"

func testDB(t *testing.T) *Probe {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	u, err := url.Parse(dsn)
	if err != nil || !strings.HasPrefix(u.Path, "/umc_huy_test") {
		t.Fatal("isolated umc_huy_test* database required")
	}
	db, err := New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if err = db.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = db.Migrate(context.Background()); err != nil {
		t.Fatal("migration not repeatable", err)
	}
	return db
}
func seedAccess(t *testing.T, db *Probe) {
	t.Helper()
	_, err := db.pool.Exec(context.Background(), `INSERT INTO user_access_projection(user_id,actor_type,status,token_version) VALUES($1,'DOCTOR','ACTIVE',1),($2,'DOCTOR','ACTIVE',1),($3,'PATIENT','ACTIVE',1) ON CONFLICT(user_id) DO UPDATE SET status='ACTIVE',token_version=1`, doctorUser, otherDoctor, patientUser)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.pool.Exec(context.Background(), `INSERT INTO patient_access_projection(patient_id,owner_user_id,active,policy_version) VALUES($1,$2,true,1) ON CONFLICT(patient_id) DO NOTHING`, patientID, patientUser)
	if err != nil {
		t.Fatal(err)
	}
}
func seedTicket(t *testing.T, db *Probe, kind, visit string) domain.Ticket {
	t.Helper()
	ticket := domain.Ticket{ID: domain.NewID(), AppointmentID: domain.NewID(), PatientID: patientID, DoctorID: doctorID, DoctorUserID: doctorUser, DepartmentID: departmentID, TicketType: kind, State: "WAITING", Version: 1, VisitID: visit}
	_, err := db.pool.Exec(context.Background(), `INSERT INTO ticket_projection(ticket_id,appointment_id,patient_id,doctor_id,doctor_user_id,department_id,ticket_type,state,version,visit_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,'')::uuid)`, ticket.ID, ticket.AppointmentID, ticket.PatientID, ticket.DoctorID, ticket.DoctorUserID, ticket.DepartmentID, ticket.TicketType, ticket.State, ticket.Version, ticket.VisitID)
	if err != nil {
		t.Fatal(err)
	}
	return ticket
}
func claimFor(ticket domain.Ticket, start domain.StartResult, state string) domain.Envelope {
	payload := domain.ClaimResult{RequestID: start.RequestID, TicketID: ticket.ID, AppointmentID: ticket.AppointmentID, PatientID: ticket.PatientID, VisitID: ticket.VisitID, State: state}
	if state == "ACCEPTED" {
		payload.ClaimID = domain.NewID()
	} else {
		payload.ReasonCode = "TICKET_ALREADY_CLAIMED"
	}
	b, _ := json.Marshal(payload)
	return domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "QueueTicketClaimed", SchemaVersion: 1, Producer: "appointment", AggregateID: ticket.ID, AggregateVersion: 2, CorrelationID: domain.NewID(), CausationID: start.RequestID, RequestID: start.RequestID, OccurredAt: time.Now().UTC(), Payload: b}
}
func TestWeek2Postgres(t *testing.T) {
	db := testDB(t)
	seedAccess(t, db)
	ctx := context.Background()
	app := usecase.New(db, time.Now)
	actor := domain.Principal{UserID: doctorUser, ActorType: "DOCTOR", TokenVersion: 1}
	other := domain.Principal{UserID: otherDoctor, ActorType: "DOCTOR", TokenVersion: 1}
	meta := domain.Meta{CorrelationID: domain.NewID(), RequestID: domain.NewID()}
	ticket := seedTicket(t, db, "FIRST", "")
	input := domain.StartInput{TicketID: ticket.ID, DoctorID: doctorID, ExpectedTicketVersion: 1}
	key := domain.NewID()
	start, err := app.Start(ctx, actor, key, input, meta)
	if err != nil || start.State != "PENDING" {
		t.Fatal(start, err)
	}
	var count int
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM visits`).Scan(&count)
	if count != 0 {
		t.Fatal("visit exists before claim")
	}
	var command domain.Envelope
	var raw []byte
	if err = db.pool.QueryRow(ctx, `SELECT envelope FROM outbox WHERE aggregate_id=$1`, start.RequestID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(raw, &command)
	if command.MessageType != "ClaimQueueTicket" || command.CorrelationID != meta.CorrelationID || command.RequestID != start.RequestID {
		t.Fatal(command)
	}
	replay, err := app.Start(ctx, actor, strings.ToUpper(key), input, meta)
	if err != nil || replay.OperationID != start.OperationID {
		t.Fatal("replay", replay, err)
	}
	input.ExpectedTicketVersion = 2
	if _, err = app.Start(ctx, actor, key, input, meta); domain.Code(err) != "IDEMPOTENCY_CONFLICT" {
		t.Fatal("payload conflict", err)
	}
	if _, err = app.Worklist(ctx, other, domain.WorklistQuery{OperationID: start.OperationID}); domain.Code(err) != "START_REQUEST_NOT_FOUND" {
		t.Fatal("poll leaked", err)
	}
	event := claimFor(ticket, start, "ACCEPTED")
	badEvent := event
	badEvent.MessageID = domain.NewID()
	var badPayload map[string]any
	_ = json.Unmarshal(badEvent.Payload, &badPayload)
	badPayload["unexpected"] = true
	badEvent.Payload, _ = json.Marshal(badPayload)
	if e := app.HandleClaim(ctx, "umc.events.appointment.v1", badEvent); domain.Code(e) != "INVALID_MESSAGE" {
		t.Fatal("unknown claim field accepted", e)
	}
	var wg sync.WaitGroup
	fail := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); fail <- app.HandleClaim(ctx, "umc.events.appointment.v1", event) }()
	}
	wg.Wait()
	close(fail)
	for e := range fail {
		if e != nil {
			t.Fatal(e)
		}
	}
	list, err := app.Worklist(ctx, actor, domain.WorklistQuery{OperationID: start.OperationID})
	if err != nil || list.Total != 1 || list.StartRequest == nil || list.StartRequest.State != "ACCEPTED" {
		t.Fatal(list, err)
	}
	visitID := list.StartRequest.VisitID
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM visits WHERE appointment_id=$1`, ticket.AppointmentID).Scan(&count)
	if count != 1 {
		t.Fatal("duplicate visits", count)
	}
	event.MessageID = domain.NewID()
	if err = app.HandleClaim(ctx, "umc.events.appointment.v1", event); err != nil {
		t.Fatal("business replay", err)
	}
	var conflict domain.ClaimResult
	_ = json.Unmarshal(event.Payload, &conflict)
	conflict.ClaimID = domain.NewID()
	event.Payload, _ = json.Marshal(conflict)
	event.MessageID = domain.NewID()
	if err = app.HandleClaim(ctx, "umc.events.appointment.v1", event); domain.Code(err) != "INVALID_MESSAGE" {
		t.Fatal("contradicting terminal claim", err)
	}
	empty := ""
	symptom := "Triệu chứng giả"
	draft := domain.DraftInput{Symptoms: &symptom, Findings: &empty, Assessment: &empty, Diagnosis: &empty, ExpectedVersion: 1}
	draftKey := domain.NewID()
	saved, err := app.SaveDraft(ctx, actor, visitID, draftKey, draft)
	if err != nil || saved.Version != 2 {
		t.Fatal(saved, err)
	}
	replayDraft, err := app.SaveDraft(ctx, actor, visitID, draftKey, draft)
	if err != nil || replayDraft.Version != 2 {
		t.Fatal("draft replay", err)
	}
	if _, err = app.SaveDraft(ctx, actor, visitID, domain.NewID(), draft); domain.Code(err) != "VISIT_VERSION_CONFLICT" {
		t.Fatal("stale overwrite", err)
	}
	if _, err = app.SaveDraft(ctx, other, visitID, domain.NewID(), draft); domain.Code(err) != "FORBIDDEN" {
		t.Fatal("doctor ownership", err)
	}
	patient := domain.Principal{UserID: patientUser, ActorType: "PATIENT", TokenVersion: 1}
	if _, err = app.Detail(ctx, patient, visitID); domain.Code(err) != "NOT_FOUND" {
		t.Fatal("patient draft disclosure", err)
	}
	_, err = db.pool.Exec(ctx, `UPDATE visits SET state='SIGNED',signed_at=now() WHERE id=$1`, visitID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = app.SaveDraft(ctx, actor, visitID, domain.NewID(), domain.DraftInput{Symptoms: &empty, Findings: &empty, Assessment: &empty, Diagnosis: &empty, ExpectedVersion: 2}); domain.Code(err) != "VISIT_ALREADY_SIGNED" {
		t.Fatal("signed mutation", err)
	}
	detail, err := app.Detail(ctx, patient, visitID)
	if err != nil || len(detail.Notes) != 1 || detail.Notes[0].Symptoms != symptom {
		t.Fatal(detail, err)
	}
	// Fixture for future RETURN: service must reuse the same appointment/visit.
	_, err = db.pool.Exec(ctx, `UPDATE visits SET state='RETURN_READY',signed_at=NULL WHERE id=$1`, visitID)
	if err != nil {
		t.Fatal(err)
	}
	rt := seedTicket(t, db, "RETURN", visitID)
	_, err = db.pool.Exec(ctx, `UPDATE ticket_projection SET appointment_id=$1 WHERE ticket_id=$2`, ticket.AppointmentID, rt.ID)
	if err != nil {
		t.Fatal(err)
	}
	rt.AppointmentID = ticket.AppointmentID
	rs, err := app.Start(ctx, actor, domain.NewID(), domain.StartInput{TicketID: rt.ID, DoctorID: doctorID, ExpectedTicketVersion: 1}, meta)
	if err != nil {
		t.Fatal(err)
	}
	if err = app.HandleClaim(ctx, "umc.events.appointment.v1", claimFor(rt, rs, "ACCEPTED")); err != nil {
		t.Fatal(err)
	}
	after, err := app.Detail(ctx, actor, visitID)
	if err != nil || after.Visit.ReturnRound != 1 || after.Visit.State != "IN_PROGRESS" {
		t.Fatal(after, err)
	}
	// A rejected claim cannot create a visit.
	rejected := seedTicket(t, db, "FIRST", "")
	pending, err := app.Start(ctx, actor, domain.NewID(), domain.StartInput{TicketID: rejected.ID, DoctorID: doctorID, ExpectedTicketVersion: 1}, meta)
	if err != nil {
		t.Fatal(err)
	}
	if err = app.HandleClaim(ctx, "umc.events.appointment.v1", claimFor(rejected, pending, "REJECTED")); err != nil {
		t.Fatal(err)
	}
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM visits WHERE appointment_id=$1`, rejected.AppointmentID).Scan(&count)
	if count != 0 {
		t.Fatal("rejected claim created visit")
	}
	// Rollback state/idempotency when outbox insertion fails.
	_, err = db.pool.Exec(ctx, `CREATE FUNCTION fail_clinical_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER fail_clinical_outbox BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION fail_clinical_outbox()`)
	if err != nil {
		t.Fatal(err)
	}
	rollback := seedTicket(t, db, "FIRST", "")
	_, err = app.Start(ctx, actor, domain.NewID(), domain.StartInput{TicketID: rollback.ID, DoctorID: doctorID, ExpectedTicketVersion: 1}, meta)
	if err == nil {
		t.Fatal("outbox failure ignored")
	}
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM start_requests WHERE ticket_id=$1`, rollback.ID).Scan(&count)
	if count != 0 {
		t.Fatal("partial start committed")
	}
	_, _ = db.pool.Exec(ctx, `DROP TRIGGER fail_clinical_outbox ON outbox; DROP FUNCTION fail_clinical_outbox()`)
	_, _ = db.pool.Exec(ctx, `UPDATE user_access_projection SET status='DISABLED' WHERE user_id=$1`, doctorUser)
	if _, err = app.Worklist(ctx, actor, domain.WorklistQuery{}); domain.Code(err) != "FORBIDDEN" {
		t.Fatal("revoked account accepted", err)
	}
}

func TestConcurrentDraftWriters(t *testing.T) {
	db := testDB(t)
	seedAccess(t, db)
	ctx := context.Background()
	app := usecase.New(db, time.Now)
	actor := domain.Principal{UserID: doctorUser, ActorType: "DOCTOR", TokenVersion: 1}
	ticket := seedTicket(t, db, "FIRST", "")
	result, err := app.Start(ctx, actor, domain.NewID(), domain.StartInput{TicketID: ticket.ID, DoctorID: doctorID, ExpectedTicketVersion: 1}, domain.Meta{})
	if err != nil {
		t.Fatal(err)
	}
	if err = app.HandleClaim(ctx, "umc.events.appointment.v1", claimFor(ticket, result, "ACCEPTED")); err != nil {
		t.Fatal(err)
	}
	work, err := app.Worklist(ctx, actor, domain.WorklistQuery{OperationID: result.OperationID})
	if err != nil {
		t.Fatal(err)
	}
	id := work.StartRequest.VisitID
	empty := ""
	input := domain.DraftInput{Symptoms: &empty, Findings: &empty, Assessment: &empty, Diagnosis: &empty, ExpectedVersion: 1}
	results := make(chan error, 6)
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := app.SaveDraft(ctx, actor, id, domain.NewID(), input)
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	success, conflicts := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if domain.Code(err) == "VISIT_VERSION_CONFLICT" {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	var count int
	_ = db.pool.QueryRow(ctx, `SELECT count(*) FROM visit_notes WHERE visit_id=$1`, id).Scan(&count)
	if success != 1 || conflicts != 5 || count != 1 {
		t.Fatal(success, conflicts, count)
	}
}

func TestIdentityProjectionRequiresFieldsAndRejectsStaleRevision(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	app := usecase.New(db, time.Now)
	id := domain.NewID()
	event := domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "IdentityAccessChanged", SchemaVersion: 1, Producer: "identity", AggregateID: id, AggregateVersion: 2, CorrelationID: domain.NewID(), CausationID: domain.NewID(), RequestID: domain.NewID(), OccurredAt: time.Now().UTC()}
	payload := map[string]any{"userId": id, "actorType": "DOCTOR", "status": "DISABLED", "version": 2, "capabilities": []string{}, "phoneVerified": true}
	event.Payload, _ = json.Marshal(payload)
	if err := app.HandleProjection(ctx, "umc.events.identity.v1", event); domain.Code(err) != "INVALID_MESSAGE" {
		t.Fatal("missing tokenVersion accepted", err)
	}
	payload["tokenVersion"] = 2
	event.Payload, _ = json.Marshal(payload)
	if err := app.HandleProjection(ctx, "umc.events.identity.v1", event); err != nil {
		t.Fatal(err)
	}
	event.MessageID = domain.NewID()
	event.AggregateVersion = 1
	payload["version"] = 1
	payload["status"] = "ACTIVE"
	payload["tokenVersion"] = 1
	event.Payload, _ = json.Marshal(payload)
	if err := app.HandleProjection(ctx, "umc.events.identity.v1", event); err != nil {
		t.Fatal(err)
	}
	var status string
	var version int
	if err := db.pool.QueryRow(ctx, `SELECT status,token_version FROM user_access_projection WHERE user_id=$1`, id).Scan(&status, &version); err != nil || status != "DISABLED" || version != 2 {
		t.Fatal(status, version, err)
	}
}
