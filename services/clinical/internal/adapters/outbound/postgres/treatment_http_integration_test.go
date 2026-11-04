//go:build integration

package postgres

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
	httpadapter "umccare/clinical/internal/adapters/inbound/http"
	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

func TestTreatmentRealHTTP(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	seedAccess(t, db)
	app := usecase.New(db, time.Now)
	p := domain.Principal{UserID: doctorUser, ActorType: "DOCTOR", TokenVersion: 1}
	newVisit := func() string {
		ticket := seedTicket(t, db, "FIRST", "")
		start, e := app.Start(ctx, p, domain.NewID(), domain.StartInput{TicketID: ticket.ID, DoctorID: doctorID, ExpectedTicketVersion: 1}, domain.Meta{})
		if e != nil {
			t.Fatal(e)
		}
		if e = app.HandleClaim(ctx, "umc.events.appointment.v1", claimFor(ticket, start, "ACCEPTED")); e != nil {
			t.Fatal(e)
		}
		var id string
		if e = db.pool.QueryRow(ctx, `SELECT visit_id::text FROM start_requests WHERE request_id=$1`, start.RequestID).Scan(&id); e != nil {
			t.Fatal(e)
		}
		return id
	}
	id := newVisit()
	labVisit := newVisit()
	medicine := domain.NewID()
	test := domain.NewID()
	if e := db.ImportCatalog(ctx, []CatalogImport{{Kind: "MEDICINE", Entity: domain.CatalogEntity{ID: medicine, Code: medicine, Name: "Trusted drug", Revision: 1, Status: "ACTIVE"}}, {Kind: "LAB_TEST", Entity: domain.CatalogEntity{ID: test, Code: test, Name: "CBC", Revision: 1, Status: "ACTIVE"}}}); e != nil {
		t.Fatal(e)
	}
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	now := time.Now()
	claims := httpadapter.Claims{ActorType: "DOCTOR", TokenVersion: 1, RegisteredClaims: jwt.RegisteredClaims{Subject: doctorUser, Issuer: "identity", Audience: jwt.ClaimStrings{"umc"}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Minute))}}
	token, _ := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
	server := httpadapter.New(db, httpadapter.Options{App: app, Auth: httpadapter.NewJWT(&key.PublicKey, "identity", "umc"), Ready: db.BusinessReady})
	fixtures := map[string]any{}
	call := func(method, path string, input any, action string, status int, name string) map[string]any {
		t.Helper()
		raw, _ := json.Marshal(input)
		request := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Idempotency-Key", domain.NewID())
		if action != "" {
			lease, _ := jwt.NewWithClaims(jwt.SigningMethodRS256, httpadapter.LeaseClaims{Action: action, TokenVersion: 1, RegisteredClaims: jwt.RegisteredClaims{Subject: doctorUser, Issuer: "identity", Audience: jwt.ClaimStrings{"umc"}, IssuedAt: jwt.NewNumericDate(time.Now()), ExpiresAt: jwt.NewNumericDate(time.Now().Add(25 * time.Second))}}).SignedString(key)
			request.Header.Set("X-Authorization-Lease", lease)
		}
		out := httptest.NewRecorder()
		server.ServeHTTP(out, request)
		if out.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, out.Code, out.Body.String())
		}
		var body map[string]any
		if e = json.Unmarshal(out.Body.Bytes(), &body); e != nil {
			t.Fatal(e)
		}
		if name != "" {
			fixtures[name] = body
		}
		return body
	}
	lines := []domain.PrescriptionLine{{MedicineCode: medicine, DoseText: "one daily", Quantity: 2, NameSnapshot: "spoof"}}
	created := call("POST", "/api/v1/visits/"+id+"/prescriptions", domain.PrescriptionInput{Lines: lines}, "", 201, "PrescriptionResponse")
	rx := created["data"].(map[string]any)["prescription"].(map[string]any)["id"].(string)
	call("POST", "/api/v1/prescriptions/"+rx+"/finalize", domain.VersionInput{ExpectedVersion: 1}, "CL-009", 409, "")
	call("PUT", "/api/v1/prescriptions/"+rx, domain.PrescriptionInput{Lines: lines, ExpectedVersion: 1}, "", 200, "PrescriptionResponse")
	second := call("POST", "/api/v1/visits/"+id+"/prescriptions", domain.PrescriptionInput{Lines: lines}, "", 201, "")
	rx2 := second["data"].(map[string]any)["prescription"].(map[string]any)["id"].(string)
	call("DELETE", "/api/v1/prescriptions/"+rx2+"?expectedVersion=1", nil, "", 200, "DeleteResponse")
	txt := "diagnosis"
	if _, e = app.SaveDraft(ctx, p, id, domain.NewID(), domain.DraftInput{Symptoms: &txt, Findings: &txt, Assessment: &txt, Diagnosis: &txt, ExpectedVersion: 1}); e != nil {
		t.Fatal(e)
	}
	call("POST", "/api/v1/visits/"+id+"/complete", domain.VersionInput{ExpectedVersion: 2}, "", 401, "Error")
	call("POST", "/api/v1/visits/"+id+"/complete", domain.VersionInput{ExpectedVersion: 2}, "CL-010", 200, "CompleteResponse")
	call("POST", "/api/v1/prescriptions/"+rx+"/finalize", domain.VersionInput{ExpectedVersion: 2}, "CL-009", 200, "PrescriptionResponse")
	var prescriptionWire []byte
	if e = db.pool.QueryRow(ctx, `SELECT envelope FROM outbox WHERE envelope->>'messageType'='PrescriptionFinalized' AND envelope->'payload'->>'prescriptionId'=$1`, rx).Scan(&prescriptionWire); e != nil {
		t.Fatal(e)
	}
	var prescriptionEnvelope domain.Envelope
	if e = json.Unmarshal(prescriptionWire, &prescriptionEnvelope); e != nil {
		t.Fatal(e)
	}
	var prescriptionPayload struct {
		PrescriptionID string `json:"prescriptionId"`
		Revision       int    `json:"revision"`
	}
	if e = json.Unmarshal(prescriptionEnvelope.Payload, &prescriptionPayload); e != nil {
		t.Fatal(e)
	}
	if prescriptionEnvelope.AggregateID != prescriptionPayload.PrescriptionID || prescriptionEnvelope.AggregateVersion != prescriptionPayload.Revision {
		t.Fatalf("PrescriptionFinalized wire aggregate must identify the prescription revision: aggregate=%s version=%d payload=%+v", prescriptionEnvelope.AggregateID, prescriptionEnvelope.AggregateVersion, prescriptionPayload)
	}
	call("POST", "/api/v1/visits/"+labVisit+"/lab-orders", domain.LabInput{Tests: []domain.TestSelection{{TestID: test, Revision: 1}}}, "", 202, "LabResponse")
	var wire []byte
	if e = db.pool.QueryRow(ctx, `SELECT envelope FROM outbox WHERE envelope->>'messageType'='CreateLabOrder' AND envelope->'payload'->>'visitId'=$1`, labVisit).Scan(&wire); e != nil {
		t.Fatal(e)
	}
	var envelope domain.Envelope
	if e = json.Unmarshal(wire, &envelope); e != nil {
		t.Fatal(e)
	}
	var command domain.CreateLabOrder
	if e = json.Unmarshal(envelope.Payload, &command); e != nil {
		t.Fatal(e)
	}
	if envelope.AggregateID != command.RequestID || envelope.RequestID != command.RequestID || envelope.AggregateVersion != 1 {
		t.Fatalf("CreateLabOrder wire aggregate must identify the registry request: aggregate=%s version=%d request=%s payloadRequest=%s", envelope.AggregateID, envelope.AggregateVersion, envelope.RequestID, command.RequestID)
	}
	if file := os.Getenv("CLINICAL_CREATE_LAB_WIRE_FILE"); file != "" {
		if e = os.WriteFile(file, wire, 0600); e != nil {
			t.Fatal(e)
		}
	}
	call("GET", "/api/v1/visits/"+labVisit, nil, "", 200, "VisitDetailResponse")
	if file := os.Getenv("CLINICAL_WEEK3_CONTRACT_RESPONSE_FILE"); file != "" {
		raw, _ := json.MarshalIndent(fixtures, "", "  ")
		if e = os.WriteFile(file, raw, 0600); e != nil {
			t.Fatal(e)
		}
	}
}
