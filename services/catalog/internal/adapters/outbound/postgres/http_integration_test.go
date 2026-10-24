//go:build integration

package postgres

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"net/http/httptest"
	"os"
	"testing"
	"time"
	httpadapter "umccare/catalog/internal/adapters/inbound/http"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/application/usecase"
	"umccare/catalog/internal/domain"
)

// Exercise all six real handlers with real RSA signatures and the real database.
func testHTTP(t *testing.T, db *Store) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	auth := httpadapter.NewJWT(&key.PublicKey, &key.PublicKey, "identity-test", "catalog")
	app := usecase.New(db, db, ports.RealClock{})
	handler := httpadapter.New(httpadapter.Config{Name: "catalog", Ready: db.Ready}, app, auth)
	sign := func(actor, id string, caps []string, action string, ttl time.Duration) string {
		t.Helper()
		now := time.Now()
		claims := httpadapter.Claims{ActorType: actor, Capabilities: caps, TokenVersion: 1, Action: action, RegisteredClaims: jwt.RegisteredClaims{Subject: id, Issuer: "identity-test", Audience: jwt.ClaimStrings{"catalog"}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(ttl))}}
		raw, e := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
		if e != nil {
			t.Fatal(e)
		}
		return raw
	}
	adminID := "00000000-0000-4000-8000-000000000901"
	admin := sign("STAFF", adminID, []string{"ADMIN"}, "", 15*time.Minute)
	doctor := sign("DOCTOR", "00000000-0000-4000-8000-000000000911", nil, "", 15*time.Minute)
	pharmacy := sign("STAFF", "00000000-0000-4000-8000-000000000902", []string{"PHARMACY"}, "", 15*time.Minute)
	lab := sign("STAFF", "00000000-0000-4000-8000-000000000903", []string{"LAB_TECH"}, "", 15*time.Minute)
	lease := sign("", adminID, nil, "CA-004", 30*time.Second)
	input := domain.PriceInput{ItemType: "LAB", ItemID: "00000000-0000-4000-8000-000000000401", AmountVND: 140000, EffectiveFrom: time.Now().UTC().Add(30 * 24 * time.Hour).Truncate(time.Microsecond)}
	raw, _ := json.Marshal(input)
	idempotencyKey := domain.NewID()
	fixtures := map[string]json.RawMessage{}
	call := func(method, path, token, leaseValue string, body []byte, want int, schema string) {
		t.Helper()
		r := httptest.NewRequest(method, path, bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Correlation-ID", "integration-http-1")
		r.Header.Set("Idempotency-Key", idempotencyKey)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		if leaseValue != "" {
			r.Header.Set("X-Authorization-Lease", leaseValue)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s => %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		if schema != "" {
			fixtures[schema] = append([]byte(nil), w.Body.Bytes()...)
		}
	}
	call("GET", "/health/ready", "", "", nil, 200, "")
	call("GET", "/api/v1/departments", "", "", nil, 200, "DepartmentsResponse")
	call("GET", "/api/v1/doctors?limit=1", "", "", nil, 200, "DoctorsResponse")
	call("GET", "/api/v1/medical-services", "", "", nil, 200, "ServicesResponse")
	call("GET", "/api/v1/catalog/medicines", doctor, "", nil, 200, "MedicinesResponse")
	call("GET", "/api/v1/catalog/lab-tests", doctor, "", nil, 200, "LabTestsResponse")
	call("GET", "/api/v1/catalog/medicines", pharmacy, "", nil, 200, "")
	call("GET", "/api/v1/catalog/lab-tests", pharmacy, "", nil, 403, "Error")
	call("GET", "/api/v1/catalog/lab-tests", lab, "", nil, 200, "")
	call("GET", "/api/v1/catalog/medicines", lab, "", nil, 403, "")
	call("POST", "/api/v1/prices", admin, "", raw, 403, "")
	tooPrecise := input
	tooPrecise.EffectiveFrom = tooPrecise.EffectiveFrom.Add(time.Nanosecond)
	invalidRaw, _ := json.Marshal(tooPrecise)
	call("POST", "/api/v1/prices", admin, lease, invalidRaw, 400, "")
	call("POST", "/api/v1/prices", admin, lease, raw, 201, "PriceResponse")
	call("POST", "/api/v1/prices", admin, lease, raw, 201, "")
	before, err := db.LabTests(t.Context(), ports.SearchQuery{}, input.EffectiveFrom.Add(-time.Microsecond))
	if err != nil || len(before) != 1 || before[0].Price != nil {
		t.Fatalf("price must not apply before its boundary: %+v %v", before, err)
	}
	at, err := db.LabTests(t.Context(), ports.SearchQuery{}, input.EffectiveFrom)
	if err != nil || len(at) != 1 || at[0].Price == nil || !at[0].Price.EffectiveFrom.Equal(input.EffectiveFrom) || at[0].Price.AmountVND != input.AmountVND {
		t.Fatalf("price boundary/read-back changed: %+v %v", at, err)
	}
	call("GET", "/api/v1/catalog/medicines", "", "", nil, 401, "")
	call("GET", "/api/v1/doctors?limit=101", "", "", nil, 400, "")
	if path := os.Getenv("CONTRACT_RESPONSE_FILE"); path != "" {
		b, e := json.MarshalIndent(fixtures, "", "  ")
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(path, b, 0600); e != nil {
			t.Fatal(e)
		}
	}
}
