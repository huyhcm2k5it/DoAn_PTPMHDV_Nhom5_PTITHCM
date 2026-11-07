//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"testing"
	"time"
	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

func TestTerminalBeforeOrderResolutionProducesOneReturn(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	seedAccess(t, db)
	s := usecase.New(db, time.Now)
	p := domain.Principal{UserID: doctorUser, ActorType: "DOCTOR", TokenVersion: 1}
	ticket := seedTicket(t, db, "FIRST", "")
	start, err := s.Start(ctx, p, domain.NewID(), domain.StartInput{TicketID: ticket.ID, DoctorID: ticket.DoctorID, ExpectedTicketVersion: 1}, domain.Meta{})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleClaim(ctx, "umc.events.appointment.v1", claimFor(ticket, start, "ACCEPTED")); err != nil {
		t.Fatal(err)
	}
	var visit string
	if err = db.pool.QueryRow(ctx, `SELECT visit_id::text FROM start_requests WHERE request_id=$1`, start.RequestID).Scan(&visit); err != nil {
		t.Fatal(err)
	}
	request, order := domain.NewID(), domain.NewID()
	request2, order2 := domain.NewID(), domain.NewID()
	if _, err = db.pool.Exec(ctx, `INSERT INTO lab_requests(request_id,visit_id,state,request_hash,tests) VALUES($1,$2,'PENDING',$3,'[]')`, request, visit, request); err != nil {
		t.Fatal(err)
	}
	if _, err = db.pool.Exec(ctx, `INSERT INTO lab_requests(request_id,visit_id,state,request_hash,tests) VALUES($1,$2,'PENDING',$3,'[]')`, request2, visit, request2); err != nil {
		t.Fatal(err)
	}
	if _, err = db.pool.Exec(ctx, `UPDATE visits SET state='LAB_REQUEST_PENDING' WHERE id=$1`, visit); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]any{"orderId": order, "visitId": visit, "revision": 1, "publishedAt": time.Now().UTC(), "recipientUserId": domain.NewID(), "version": 2})
	event := domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "LabResultPublished", SchemaVersion: 1, Producer: "diagnostic", AggregateID: order, AggregateVersion: 2, CorrelationID: "test", CausationID: domain.NewID(), RequestID: request, OccurredAt: time.Now(), Payload: payload}
	if err = s.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", event); err != nil {
		t.Fatalf("early terminal event: %v", err)
	}
	resolvedPayload, _ := json.Marshal(map[string]any{"requestId": request, "visitId": visit, "state": "CREATED", "orderId": order, "reasonCode": "", "version": 1})
	resolved := domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "LabOrderResolved", SchemaVersion: 1, Producer: "diagnostic", AggregateID: request, AggregateVersion: 1, CorrelationID: "test", CausationID: domain.NewID(), RequestID: request, OccurredAt: time.Now(), Payload: resolvedPayload}
	if err = s.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", resolved); err != nil {
		t.Fatalf("resolution: %v", err)
	}
	var interim string
	if err = db.pool.QueryRow(ctx, `SELECT state FROM visits WHERE id=$1`, visit).Scan(&interim); err != nil {
		t.Fatal(err)
	}
	if interim != "LAB_REQUEST_PENDING" {
		t.Fatalf("premature return with another pending order: %s", interim)
	}
	resolvedPayload2, _ := json.Marshal(map[string]any{"requestId": request2, "visitId": visit, "state": "CREATED", "orderId": order2, "reasonCode": "", "version": 1})
	resolved2 := domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "LabOrderResolved", SchemaVersion: 1, Producer: "diagnostic", AggregateID: request2, AggregateVersion: 1, CorrelationID: "test", CausationID: domain.NewID(), RequestID: request2, OccurredAt: time.Now(), Payload: resolvedPayload2}
	if err = s.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", resolved2); err != nil {
		t.Fatal(err)
	}
	cancelPayload, _ := json.Marshal(map[string]any{"orderId": order2, "visitId": visit, "cancellationId": domain.NewID(), "noSpecimen": true, "reasonCode": "DOCTOR_REQUEST", "version": 2})
	cancelled := domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "LabCancelled", SchemaVersion: 1, Producer: "diagnostic", AggregateID: order2, AggregateVersion: 2, CorrelationID: "test", CausationID: domain.NewID(), RequestID: request2, OccurredAt: time.Now(), Payload: cancelPayload}
	if err = s.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", cancelled); err != nil {
		t.Fatal(err)
	}
	if err = s.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", cancelled); err != nil {
		t.Fatal(err)
	}
	if err = s.HandleTreatmentMessage(ctx, "umc.events.diagnostic.v1", event); err != nil {
		t.Fatalf("replay: %v", err)
	}
	var state, requestState string
	var events int
	if err = db.pool.QueryRow(ctx, `SELECT state FROM visits WHERE id=$1`, visit).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if err = db.pool.QueryRow(ctx, `SELECT state FROM lab_requests WHERE request_id=$1`, request).Scan(&requestState); err != nil {
		t.Fatal(err)
	}
	var revision int
	var publishedAt time.Time
	if err = db.pool.QueryRow(ctx, `SELECT revision,published_at FROM lab_terminal_projection WHERE request_id=$1`, request).Scan(&revision, &publishedAt); err != nil {
		t.Fatal(err)
	}
	if revision != 1 || publishedAt.IsZero() {
		t.Fatalf("published metadata missing: revision=%d publishedAt=%v", revision, publishedAt)
	}
	if err = db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE aggregate_id=$1 AND envelope->>'messageType'='VisitReturnReady'`, visit).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if state != "RETURN_READY" || requestState != "PUBLISHED" || events != 1 {
		t.Fatalf("visit=%s lab=%s return events=%d", state, requestState, events)
	}
}
