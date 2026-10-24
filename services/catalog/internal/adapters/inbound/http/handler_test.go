package httpadapter

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
)

type fakeCatalog struct{ ports.Catalog }

func (fakeCatalog) Departments(context.Context) ([]domain.Department, error) {
	return []domain.Department{}, nil
}
func (fakeCatalog) Doctors(context.Context, ports.DoctorQuery) (ports.Doctors, error) {
	return ports.Doctors{}, domain.Fail("VALIDATION_ERROR", "bad filter")
}
func (fakeCatalog) CreatePrice(context.Context, domain.Principal, string, domain.PriceInput, ports.Meta) (domain.PriceResult, error) {
	panic("invalid request reached usecase")
}
func TestPublicHealthAndErrors(t *testing.T) {
	server := New(Config{Name: "catalog", Ready: func(context.Context) error { return errors.New("secret connection string") }}, fakeCatalog{}, nil)
	for _, tc := range []struct {
		path   string
		status int
		code   string
	}{{"/health/live", 200, ""}, {"/health/ready", 503, "SERVICE_UNAVAILABLE"}, {"/api/v1/departments", 200, ""}, {"/api/v1/doctors?page=bad", 400, "VALIDATION_ERROR"}, {"/api/v1/doctors?page=0", 400, "VALIDATION_ERROR"}, {"/api/v1/prices", 405, "METHOD_NOT_ALLOWED"}, {"/unknown", 404, "NOT_FOUND"}} {
		t.Run(tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			req.Header.Set("X-Correlation-ID", "invalid value with spaces")
			server.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status=%d %s", w.Code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "secret") {
				t.Fatal("dependency error leaked")
			}
			var data map[string]any
			if e := json.Unmarshal(w.Body.Bytes(), &data); e != nil {
				t.Fatal(e)
			}
			if tc.code != "" && data["error"].(map[string]any)["code"] != tc.code {
				t.Fatal(data)
			}
			if w.Header().Get("X-Correlation-ID") == "invalid value with spaces" {
				t.Fatal("unsafe correlation ID echoed")
			}
		})
	}
}
func TestProtectedRoutesFailClosed(t *testing.T) {
	e := New(Config{Name: "catalog", Ready: func(context.Context) error { return nil }}, fakeCatalog{}, nil)
	for _, path := range []string{"/api/v1/catalog/medicines", "/api/v1/catalog/lab-tests"} {
		w := httptest.NewRecorder()
		e.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 401 {
			t.Fatalf("%s status %d", path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/v1/prices", strings.NewReader(`{"amountVnd":1}`))
	req.Header.Set("Content-Type", "application/json")
	e.ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
}

type authFixture struct{}

func (authFixture) Authenticate(_ context.Context, _, _ string, _ bool) (domain.Principal, error) {
	return domain.Principal{UserID: "test"}, nil
}
func TestStrictJSONRejectsUnknownAndFractionalAmount(t *testing.T) {
	e := New(Config{Name: "catalog"}, fakeCatalog{}, authFixture{})
	for _, body := range []string{`{"amountVnd":1.5}`, `{"amountVnd":1,"actorType":"STAFF"}`, `{} {}`} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/v1/prices", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer fixture")
		e.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("body=%s status=%d %s", body, w.Code, w.Body.String())
		}
	}
}
