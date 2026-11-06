//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

func TestDiagnosticPublishedResultWire(t *testing.T) {
	path := os.Getenv("DIAGNOSTIC_RESULT_EVENT_FILE")
	if path == "" {
		t.Skip("DIAGNOSTIC_RESULT_EVENT_FILE not supplied; Diagnostic integration produces the wire fixture")
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var event domain.Envelope
	if err = json.Unmarshal(body, &event); err != nil {
		t.Fatal(err)
	}
	var payload struct {
		OrderID         string    `json:"orderId"`
		VisitID         string    `json:"visitId"`
		Revision        int       `json:"revision"`
		PublishedAt     time.Time `json:"publishedAt"`
		RecipientUserID string    `json:"recipientUserId"`
		Version         int       `json:"version"`
	}
	if event.MessageType != "LabResultPublished" || event.Producer != "diagnostic" || json.Unmarshal(event.Payload, &payload) != nil || !domain.ValidID(payload.OrderID) || !domain.ValidID(payload.VisitID) || event.AggregateID != payload.OrderID || event.RequestID == "" {
		t.Fatalf("invalid Diagnostic wire envelope: %s", body)
	}
	if strings.Contains(string(body), "private-result") || strings.Contains(string(body), "valueText") {
		t.Fatal("Diagnostic published result event contains medical result values")
	}

	db := testDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	if _, err = db.pool.Exec(ctx, `INSERT INTO visits(id,appointment_id,patient_id,doctor_user_id,department_id,claim_id,state,version,return_round,started_at) VALUES($1,$2,$3,$4,$5,$6,'LAB_REQUEST_PENDING',1,0,$7)`, payload.VisitID, domain.NewID(), domain.NewID(), domain.NewID(), domain.NewID(), domain.NewID(), now); err != nil {
		t.Fatal(err)
	}
	if _, err = db.pool.Exec(ctx, `INSERT INTO lab_requests(request_id,visit_id,state,order_id,request_hash,tests) VALUES($1,$2,'CREATED',$3,$4,'[]')`, event.RequestID, payload.VisitID, payload.OrderID, domain.Hash(event.RequestID)); err != nil {
		t.Fatal(err)
	}

	receiver := usecase.NewReceiver(usecase.New(db, time.Now), db)
	incoming := ports.Incoming{MessageID: event.MessageID, Exchange: "umc.events.diagnostic.v1", RoutingKey: "diagnostic.lab-result-published.v1", Body: body}
	if err = receiver.Receive(ctx, incoming); err != nil {
		t.Fatal(err)
	}
	if err = receiver.Receive(ctx, incoming); err != nil {
		t.Fatal("duplicate Diagnostic event was not acknowledged: ", err)
	}
	var requestState, visitState, terminalState string
	var returnEvents int
	if err = db.pool.QueryRow(ctx, `SELECT state FROM lab_requests WHERE request_id=$1`, event.RequestID).Scan(&requestState); err != nil {
		t.Fatal(err)
	}
	if err = db.pool.QueryRow(ctx, `SELECT state FROM visits WHERE id=$1`, payload.VisitID).Scan(&visitState); err != nil {
		t.Fatal(err)
	}
	if err = db.pool.QueryRow(ctx, `SELECT state FROM lab_terminal_projection WHERE request_id=$1`, event.RequestID).Scan(&terminalState); err != nil {
		t.Fatal(err)
	}
	if err = db.pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE aggregate_id=$1 AND envelope->>'messageType'='VisitReturnReady'`, payload.VisitID).Scan(&returnEvents); err != nil {
		t.Fatal(err)
	}
	if requestState != "PUBLISHED" || terminalState != "PUBLISHED" || visitState != "RETURN_READY" || returnEvents != 1 {
		t.Fatalf("Diagnostic event was not projected exactly once: request=%s terminal=%s visit=%s returnEvents=%d", requestState, terminalState, visitState, returnEvents)
	}
}
