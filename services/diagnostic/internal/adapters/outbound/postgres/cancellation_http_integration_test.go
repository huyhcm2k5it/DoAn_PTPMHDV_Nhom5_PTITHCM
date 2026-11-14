//go:build integration

package postgres

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	httpadapter "umccare/diagnostic/internal/adapters/inbound/http"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/application/projection"
	"umccare/diagnostic/internal/domain"
)

func TestCancellationHTTPReturnsStableRefundEvidenceWithCurrentAuthorization(t *testing.T) {
	db := testDB(t)
	s, in, _ := setup(t, db)
	o := createOrder(t, db, s, in)
	pay(t, s, o)
	ctx := context.Background()
	doctor := domain.NewID()
	if err := db.Within(ctx, "diagnostic:business", func(raw ports.Tx) error {
		return raw.Put(ctx, "access", doctor, domain.Access{UserID: doctor, ActorType: "DOCTOR", Status: "ACTIVE", TokenVersion: 1})
	}); err != nil {
		t.Fatal(err)
	}
	grant := func(sequence int, active, canCancel bool) {
		t.Helper()
		now := time.Now().UTC()
		if err := db.Within(ctx, "diagnostic:business", func(raw ports.Tx) error {
			tx := raw.(diagnosticTx)
			g := projection.VisitGrantEvent{Mode: "UPSERT", Sequence: sequence, VisitID: in.VisitID, PatientID: in.PatientID, DoctorUserID: doctor, Active: &active, CanCancel: &canCancel}
			if _, e := projection.ApplyVisitGrant(ctx, tx, domain.Envelope{AggregateID: in.VisitID, AggregateVersion: sequence, OccurredAt: now}, g, now); e != nil {
				return e
			}
			_, e := projection.ApplyVisitGrant(ctx, tx, domain.Envelope{AggregateID: projection.VisitGrantStreamID, AggregateVersion: sequence + 1, OccurredAt: now}, projection.VisitGrantEvent{Mode: "CHECKPOINT", Sequence: sequence + 1}, now)
			return e
		}); err != nil {
			t.Fatal(err)
		}
	}
	grant(1, true, true)
	var version int
	if err := db.pool.QueryRow(ctx, "SELECT (body->'order'->>'version')::int FROM lab_orders WHERE id=$1", o.ID).Scan(&version); err != nil {
		t.Fatal(err)
	}
	signingKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := httpadapter.New(db, httpadapter.Options{App: s, Auth: httpadapter.NewJWT(&signingKey.PublicKey, "diag-test", "umc-test"), Ready: db.BusinessReady})
	call := func(method, idem string, want int) map[string]any {
		t.Helper()
		now := time.Now()
		claims := jwt.RegisteredClaims{Subject: doctor, Issuer: "diag-test", Audience: jwt.ClaimStrings{"umc-test"}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(25 * time.Second))}
		access, e := jwt.NewWithClaims(jwt.SigningMethodRS256, httpadapter.Claims{ActorType: "DOCTOR", TokenVersion: 1, RegisteredClaims: claims}).SignedString(signingKey)
		if e != nil {
			t.Fatal(e)
		}
		lease, e := jwt.NewWithClaims(jwt.SigningMethodRS256, httpadapter.LeaseClaims{Action: "DI-012", TokenVersion: 1, RegisteredClaims: claims}).SignedString(signingKey)
		if e != nil {
			t.Fatal(e)
		}
		body, _ := json.Marshal(domain.CancelInput{ReasonCode: "NOT_NEEDED", ExpectedVersion: version})
		path := "/api/v1/diagnostic-orders/" + o.ID
		if method == "POST" {
			path += "/cancel"
		}
		req := httptest.NewRequest(method, path, strings.NewReader(string(body)))
		req.Header.Set("Authorization", "Bearer "+access)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Authorization-Lease", lease)
		req.Header.Set("Idempotency-Key", idem)
		w := httptest.NewRecorder()
		server.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s expected %d, got %d: %s", method, want, w.Code, w.Body.String())
		}
		var response map[string]any
		if e = json.Unmarshal(w.Body.Bytes(), &response); e != nil {
			t.Fatal(e)
		}
		d, _ := response["data"].(map[string]any)
		return d
	}
	key := domain.NewID()
	first := call("POST", key, 200)
	id, _ := first["cancellationId"].(string)
	if !domain.ValidID(id) {
		t.Fatalf("missing refund evidence: %+v", first)
	}
	var eventID string
	if err = db.pool.QueryRow(ctx, "SELECT envelope->'payload'->>'cancellationId' FROM outbox WHERE envelope->>'messageType'='LabCancelled' AND aggregate_id=$1", o.ID).Scan(&eventID); err != nil {
		t.Fatal(err)
	}
	if eventID != id {
		t.Fatal("HTTP refund evidence differs from owner event")
	}
	grant(3, true, false)
	if again := call("POST", key, 200); again["cancellationId"] != id {
		t.Fatal("signed visit retry lost evidence")
	}
	if detail := call("GET", "", 200); detail["cancellationId"] != id {
		t.Fatal("detail lost evidence")
	}
	call("POST", domain.NewID(), 409)
	// An old stored idempotency response is hydrated from the same owner record.
	if _, err = db.pool.Exec(ctx, `UPDATE objects SET value=jsonb_set(value,'{response}',(value->'response')-'cancellationId') WHERE kind='replay' AND key=$1`, doctor+":DI-012:"+key); err != nil {
		t.Fatal(err)
	}
	if again := call("POST", key, 200); again["cancellationId"] != id {
		t.Fatal("legacy replay created/lost evidence")
	}
	grant(5, false, false)
	call("GET", "", 404)
	call("POST", key, 404)
	var count int
	if err = db.pool.QueryRow(ctx, "SELECT count(*) FROM outbox WHERE envelope->>'messageType'='LabCancelled'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("retries duplicated event: %d %v", count, err)
	}
}
