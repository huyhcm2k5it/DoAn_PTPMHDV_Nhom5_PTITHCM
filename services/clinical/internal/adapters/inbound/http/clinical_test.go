package httpadapter

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"umccare/clinical/internal/domain"
)

type fakeClinical struct {
	calls int
	input domain.DraftInput
	meta  domain.Meta
}

func (f *fakeClinical) Worklist(context.Context, domain.Principal, domain.WorklistQuery) (domain.Worklist, error) {
	return domain.Worklist{Items: []domain.Visit{}}, nil
}
func (f *fakeClinical) Start(_ context.Context, _ domain.Principal, _ string, _ domain.StartInput, m domain.Meta) (domain.StartResult, error) {
	f.calls++
	f.meta = m
	id := domain.NewID()
	return domain.StartResult{RequestID: id, OperationID: id, State: "PENDING", StatusURL: "/api/v1/clinical/worklist?operationId=" + id}, nil
}
func (f *fakeClinical) Detail(context.Context, domain.Principal, string) (domain.VisitDetail, error) {
	return domain.VisitDetail{}, domain.Fail("NOT_FOUND", "Visit not found")
}
func (f *fakeClinical) SaveDraft(_ context.Context, _ domain.Principal, _ string, _ string, input domain.DraftInput) (domain.DraftResult, error) {
	f.calls++
	f.input = input
	if e := input.Validate(); e != nil {
		return domain.DraftResult{}, e
	}
	return domain.DraftResult{Version: 2, State: "IN_PROGRESS"}, nil
}

type fakeAuth struct{}

func (fakeAuth) Authenticate(context.Context, string) (domain.Principal, error) {
	return domain.Principal{UserID: domain.NewID(), ActorType: "DOCTOR", TokenVersion: 1}, nil
}

func TestStartHTTPReturns202LocationAndCorrelation(t *testing.T) {
	app := &fakeClinical{}
	server := New(probe{}, Options{App: app, Auth: fakeAuth{}})
	req := httptest.NewRequest("POST", "/api/v1/visits/start", strings.NewReader(`{"ticketId":"11111111-0000-0000-0000-000000000001","doctorId":"22222222-0000-0000-0000-000000000001","expectedTicketVersion":1}`))
	req.Header.Set("Authorization", "Bearer valid")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", domain.NewID())
	req.Header.Set("X-Correlation-ID", "week2-http-1")
	out := httptest.NewRecorder()
	server.ServeHTTP(out, req)
	if out.Code != 202 || !strings.HasPrefix(out.Header().Get("Location"), "/api/v1/clinical/worklist?operationId=") || out.Header().Get("X-Correlation-ID") != "week2-http-1" {
		t.Fatal(out.Code, out.Body.String(), out.Header())
	}
	var body struct {
		Data domain.StartResult `json:"data"`
	}
	_ = json.Unmarshal(out.Body.Bytes(), &body)
	if body.Data.State != "PENDING" || app.meta.CorrelationID != "week2-http-1" || !domain.ValidID(app.meta.RequestID) {
		t.Fatal(body, app.meta)
	}
}
func TestStrictDraftBodyAndAuthentication(t *testing.T) {
	app := &fakeClinical{}
	server := New(probe{}, Options{App: app, Auth: fakeAuth{}})
	for _, body := range []string{`{"symptoms":"","findings":"","assessment":"","expectedVersion":1}`, `{"symptoms":"","findings":"","assessment":"","diagnosis":"","expectedVersion":1,"patientId":"spoof"}`, `{} {}`} {
		req := httptest.NewRequest("PUT", "/api/v1/visits/11111111-0000-0000-0000-000000000001/draft", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer valid")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", domain.NewID())
		out := httptest.NewRecorder()
		server.ServeHTTP(out, req)
		if out.Code != 400 {
			t.Fatal(out.Code, out.Body.String())
		}
	}
	req := httptest.NewRequest("GET", "/api/v1/clinical/worklist", nil)
	out := httptest.NewRecorder()
	server.ServeHTTP(out, req)
	if out.Code != 401 {
		t.Fatal(out.Code)
	}
}
func TestHTTPInvalidQueryIsRejectedBeforeCallingApp(t *testing.T) {
	app := &fakeClinical{}
	server := New(probe{}, Options{App: app, Auth: fakeAuth{}})
	for _, query := range []string{"page=oops", "limit=0", "date=2026-02-30", "state=UNKNOWN", "operationId=no", "page=1&page=2"} {
		req := httptest.NewRequest("GET", "/api/v1/clinical/worklist?"+query, nil)
		req.Header.Set("Authorization", "Bearer valid")
		out := httptest.NewRecorder()
		server.ServeHTTP(out, req)
		if out.Code != 400 {
			t.Fatal(query, out.Code, out.Body.String())
		}
	}
}
