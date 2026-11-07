//go:build integration

package postgres

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	httpadapter "umccare/diagnostic/internal/adapters/inbound/http"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

func TestResultLifecycleRealHTTPAndPostgres(t *testing.T) {
	db := testDB(t)
	s, in, tech := setup(t, db)
	o := createOrder(t, db, s, in)
	pay(t, s, o)
	if _, err := s.Sample(context.Background(), tech, o.ID, domain.NewID(), domain.SampleInput{}, false); err != nil {
		t.Fatal(err)
	}
	tech.Capabilities = []string{"LAB_TECH", "LAB_REVIEW"}
	reviewer := domain.Principal{UserID: domain.NewID(), ActorType: "STAFF", TokenVersion: 1, Capabilities: []string{"LAB_REVIEW"}}
	if err := db.Within(context.Background(), "diagnostic:business", func(tx ports.Tx) error {
		for _, p := range []domain.Principal{tech, reviewer} {
			if err := tx.Put(context.Background(), "access", p.UserID, domain.Access{UserID: p.UserID, ActorType: p.ActorType, Status: "ACTIVE", TokenVersion: p.TokenVersion, Capabilities: p.Capabilities}); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := httpadapter.New(db, httpadapter.Options{App: s, Auth: httpadapter.NewJWT(&key.PublicKey, "diag-test", "umc-test"), Ready: db.BusinessReady})
	request := func(p domain.Principal, action, method, path string, body any, status int) map[string]any {
		t.Helper()
		now := time.Now()
		common := jwt.RegisteredClaims{Subject: p.UserID, Issuer: "diag-test", Audience: jwt.ClaimStrings{"umc-test"}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(25 * time.Second))}
		access, e := jwt.NewWithClaims(jwt.SigningMethodRS256, httpadapter.Claims{ActorType: p.ActorType, TokenVersion: p.TokenVersion, Capabilities: p.Capabilities, RegisteredClaims: common}).SignedString(key)
		if e != nil {
			t.Fatal(e)
		}
		lease, e := jwt.NewWithClaims(jwt.SigningMethodRS256, httpadapter.LeaseClaims{Action: action, TokenVersion: p.TokenVersion, RegisteredClaims: common}).SignedString(key)
		if e != nil {
			t.Fatal(e)
		}
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		r.Header.Set("Authorization", "Bearer "+access)
		r.Header.Set("X-Authorization-Lease", lease)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", domain.NewID())
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		var result map[string]any
		if e = json.Unmarshal(w.Body.Bytes(), &result); e != nil {
			t.Fatal(e)
		}
		return result
	}
	doctor := domain.Principal{UserID: domain.NewID(), ActorType: "DOCTOR", TokenVersion: 1}
	if err = db.Within(context.Background(), "diagnostic:business", func(tx ports.Tx) error {
		if err := tx.Put(context.Background(), "access", doctor.UserID, domain.Access{UserID: doctor.UserID, ActorType: "DOCTOR", Status: "ACTIVE", TokenVersion: 1}); err != nil {
			return err
		}
		return tx.Put(context.Background(), "DOCTOR", in.DoctorID, map[string]any{"identityUserId": doctor.UserID})
	}); err != nil {
		t.Fatal(err)
	}
	recoveryError := request(doctor, "DI-012", "POST", "/api/v1/diagnostic-orders/"+o.ID+"/cancel", map[string]any{"reasonCode": "DOCTOR_REQUEST", "expectedVersion": 1}, 503)
	items := []map[string]any{{"testCode": "CBC", "valueText": "private-result", "unit": "g/L", "referenceRange": "10-20"}}
	created := request(tech, "DI-007", "POST", "/api/v1/diagnostic-orders/"+o.ID+"/results", map[string]any{"items": items}, 201)
	result := created["data"].(map[string]any)["result"].(map[string]any)
	id := result["id"].(string)
	path := "/api/v1/results/" + id
	request(tech, "DI-008", "PUT", path, map[string]any{"items": items, "expectedVersion": 1}, 200)
	request(tech, "DI-009", "POST", path+"/submit-review", map[string]any{"expectedVersion": 2}, 200)
	request(tech, "DI-011", "POST", path+"/publish", map[string]any{"expectedVersion": 3}, 403)
	request(reviewer, "DI-010", "POST", path+"/return-rework", map[string]any{"expectedVersion": 3, "reason": "verify sample"}, 200)
	request(tech, "DI-008", "PUT", path, map[string]any{"items": items, "expectedVersion": 4}, 200)
	request(tech, "DI-009", "POST", path+"/submit-review", map[string]any{"expectedVersion": 5}, 200)
	published := request(reviewer, "DI-011", "POST", path+"/publish", map[string]any{"expectedVersion": 6}, 200)
	request(tech, "DI-008", "PUT", path, map[string]any{"items": items, "expectedVersion": 7}, 409)
	var raw []byte
	if err = db.pool.QueryRow(context.Background(), `SELECT envelope FROM outbox WHERE envelope->>'messageType'='LabResultPublished'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var envelope domain.Envelope
	if err = json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err = json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if envelope.RequestID != o.RequestID || envelope.AggregateID != o.ID || len(payload) != 6 || payload["orderId"] != o.ID || strings.Contains(string(raw), "private-result") {
		t.Fatalf("invalid lifecycle event: %s", raw)
	}
	if path := os.Getenv("DIAGNOSTIC_RESULT_EVENT_FILE"); path != "" {
		if err = os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if path := os.Getenv("DIAGNOSTIC_RESULT_RESPONSE_FILE"); path != "" {
		raw, _ = json.Marshal(map[string]any{"ResultDataResponse": published})
		if err = os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	var patientProjection struct {
		OwnerUserID string `json:"ownerUserId"`
		Active      bool   `json:"active"`
	}
	if err = db.Within(context.Background(), "diagnostic:business", func(tx ports.Tx) error {
		b, e := tx.Get(context.Background(), "patient", in.PatientID)
		if e != nil {
			return e
		}
		if e = json.Unmarshal(b, &patientProjection); e != nil {
			return e
		}
		patientAccess := domain.Access{UserID: patientProjection.OwnerUserID, ActorType: "PATIENT", Status: "ACTIVE", TokenVersion: 5}
		return tx.Put(context.Background(), "access", patientProjection.OwnerUserID, patientAccess)
	}); err != nil {
		t.Fatal(err)
	}
	patientPrincipal := domain.Principal{UserID: patientProjection.OwnerUserID, ActorType: "PATIENT", TokenVersion: 5}
	response := request(patientPrincipal, "DI-013", "GET", "/api/v1/patients/"+in.PatientID+"/published-results?page=1&limit=10", nil, 200)
	resultItems := response["data"].(map[string]any)["items"].([]any)
	if len(resultItems) != 1 || resultItems[0].(map[string]any)["state"] != "PUBLISHED" {
		t.Fatalf("owner did not receive only published result: %+v", response)
	}
	request(doctor, "", "GET", "/api/v1/diagnostic-orders/"+o.ID, nil, 503)
	if path := os.Getenv("DIAGNOSTIC_RESULT_RESPONSE_FILE"); path != "" {
		fixtures := map[string]any{"PublishedResultsResponse": response, "Error": recoveryError}
		if raw, e := os.ReadFile(path); e == nil {
			if e = json.Unmarshal(raw, &fixtures); e != nil {
				t.Fatal(e)
			}
			fixtures["PublishedResultsResponse"] = response
			fixtures["Error"] = recoveryError
		} else if !os.IsNotExist(e) {
			t.Fatal(e)
		}
		raw, e := json.MarshalIndent(fixtures, "", "  ")
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(path, raw, 0600); e != nil {
			t.Fatal(e)
		}
	}
}
