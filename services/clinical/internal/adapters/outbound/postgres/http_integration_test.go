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

func TestRealClinicalHTTP(t *testing.T) {
	db := testDB(t)
	seedAccess(t, db)
	app := usecase.New(db, time.Now)
	ctx := context.Background()
	ticket := seedTicket(t, db, "FIRST", "")
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	token, e := jwt.NewWithClaims(jwt.SigningMethodRS256, httpadapter.Claims{ActorType: "DOCTOR", TokenVersion: 1, RegisteredClaims: jwt.RegisteredClaims{Subject: doctorUser, Issuer: "clinical-test", Audience: jwt.ClaimStrings{"umc-test"}, IssuedAt: jwt.NewNumericDate(time.Now().Add(-time.Second)), ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute))}}).SignedString(key)
	if e != nil {
		t.Fatal(e)
	}
	server := httpadapter.New(db, httpadapter.Options{App: app, Auth: httpadapter.NewJWT(&key.PublicKey, "clinical-test", "umc-test"), Ready: db.BusinessReady})
	fixtures := map[string]any{}
	request := func(method, path, body, key string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", key)
		req.Header.Set("X-Correlation-ID", "clinical-http-test")
		out := httptest.NewRecorder()
		server.ServeHTTP(out, req)
		return out
	}
	capture := func(name string, out *httptest.ResponseRecorder) {
		var v any
		if e := json.Unmarshal(out.Body.Bytes(), &v); e != nil {
			t.Fatal(e)
		}
		fixtures[name] = v
	}
	body, _ := json.Marshal(domain.StartInput{TicketID: ticket.ID, DoctorID: doctorID, ExpectedTicketVersion: 1})
	out := request("POST", "/api/v1/visits/start", string(body), domain.NewID())
	if out.Code != 202 {
		t.Fatal(out.Code, out.Body.String())
	}
	capture("StartResponse", out)
	var started struct {
		Data domain.StartResult `json:"data"`
	}
	_ = json.Unmarshal(out.Body.Bytes(), &started)
	if out.Header().Get("Location") != started.Data.StatusURL || out.Header().Get("X-Correlation-ID") != "clinical-http-test" {
		t.Fatal(out.Header())
	}
	out = request("GET", started.Data.StatusURL, "", "")
	if out.Code != 200 {
		t.Fatal(out.Code, out.Body.String())
	}
	capture("WorklistResponse", out)
	if e = app.HandleClaim(ctx, "umc.events.appointment.v1", claimFor(ticket, started.Data, "ACCEPTED")); e != nil {
		t.Fatal(e)
	}
	out = request("GET", started.Data.StatusURL, "", "")
	if out.Code != 200 {
		t.Fatal(out.Body.String())
	}
	var work struct {
		Data domain.Worklist `json:"data"`
	}
	_ = json.Unmarshal(out.Body.Bytes(), &work)
	if work.Data.StartRequest == nil || work.Data.StartRequest.VisitID == "" {
		t.Fatal(out.Body.String())
	}
	id := work.Data.StartRequest.VisitID
	out = request("GET", "/api/v1/visits/"+id, "", "")
	if out.Code != 200 {
		t.Fatal(out.Body.String())
	}
	capture("VisitDetailResponse", out)
	out = request("PUT", "/api/v1/visits/"+id+"/draft", `{"symptoms":"test only","findings":"","assessment":"","diagnosis":"","expectedVersion":1}`, domain.NewID())
	if out.Code != 200 {
		t.Fatal(out.Body.String())
	}
	capture("DraftResponse", out)
	out = request("PUT", "/api/v1/visits/"+id+"/draft", `{"symptoms":"stale","findings":"","assessment":"","diagnosis":"","expectedVersion":1}`, domain.NewID())
	if out.Code != 409 {
		t.Fatal(out.Code, out.Body.String())
	}
	capture("Error", out)
	out = request("GET", "/api/v1/clinical/worklist?state=IN_PROGRESS&limit=1&page=1", "", "")
	if out.Code != 200 {
		t.Fatal(out.Body.String())
	}
	if file := os.Getenv("CLINICAL_CONTRACT_RESPONSE_FILE"); file != "" {
		raw, e := json.MarshalIndent(fixtures, "", "  ")
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(file, raw, 0600); e != nil {
			t.Fatal(e)
		}
	}
}
