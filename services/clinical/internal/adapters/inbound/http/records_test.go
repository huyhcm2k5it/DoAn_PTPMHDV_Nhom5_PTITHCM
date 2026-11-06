package httpadapter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

type recordsAuth struct{}

func (recordsAuth) Authenticate(context.Context, string) (domain.Principal, error) {
	return domain.Principal{UserID: domain.NewID(), ActorType: "PATIENT", TokenVersion: 1}, nil
}
func (recordsAuth) LeasePrincipal(_ context.Context, raw string, p domain.Principal, action string) (domain.Principal, error) {
	if raw != "valid" || action != "CL-011" {
		return p, domain.Fail("AUTHZ_LEASE_EXPIRED", "Lease required")
	}
	p.LeaseAction, p.LeaseExpiresAt = action, time.Now().Add(time.Minute)
	return p, nil
}

type recordsApp struct{ ports.Clinical }

func (recordsApp) Records(_ context.Context, p domain.Principal, patient string, page, limit int) (domain.MedicalRecords, error) {
	if p.LeaseAction != "CL-011" || !domain.ValidID(patient) || page != 2 || limit != 5 {
		return domain.MedicalRecords{}, domain.Fail("VALIDATION_ERROR", "Invalid request")
	}
	return domain.MedicalRecords{Items: []domain.MedicalRecord{}, Total: 0}, nil
}
func TestMedicalRecordsRouteRequiresLeaseAndNoStore(t *testing.T) {
	server := New(nil, Options{App: recordsApp{}, Auth: recordsAuth{}})
	path := "/api/v1/patients/" + domain.NewID() + "/medical-records?page=2&limit=5"
	for _, tc := range []struct {
		lease  string
		status int
	}{{"", 401}, {"valid", 200}} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer token")
		req.Header.Set("X-Authorization-Lease", tc.lease)
		res := httptest.NewRecorder()
		server.ServeHTTP(res, req)
		if res.Code != tc.status || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("status=%d cache=%q body=%s", res.Code, res.Header().Get("Cache-Control"), res.Body)
		}
	}
}
