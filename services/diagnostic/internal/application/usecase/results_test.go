package usecase

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"umccare/diagnostic/internal/domain"
)

func TestResultLifecycleRequiresIndependentReviewerAndPublishesIdentifiersOnly(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC)
	m := &memory{objects: map[string]json.RawMessage{}}
	a, b, patient, owner := domain.NewID(), domain.NewID(), domain.NewID(), domain.NewID()
	for _, id := range []string{a, b} {
		if err := m.Put(ctx, "access", id, domain.Access{UserID: id, ActorType: "STAFF", Status: "ACTIVE", TokenVersion: 1, Capabilities: []string{"LAB_TECH", "LAB_REVIEW"}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.Put(ctx, "patient", patient, map[string]any{"ownerUserId": owner, "active": true}); err != nil {
		t.Fatal(err)
	}
	o := domain.Order{ID: domain.NewID(), RequestID: domain.NewID(), VisitID: domain.NewID(), PatientID: patient, State: "SPECIMEN_COLLECTED", Version: 1, Tests: []domain.TestSnapshot{{Code: "CBC", Unit: "g/L", ReferenceRange: "10-20"}}, Specimens: []domain.Specimen{{ID: domain.NewID(), State: "COLLECTED"}}}
	m.orders = []domain.Order{o}
	s := New(m, func() time.Time { return now })
	p := domain.Principal{UserID: a, ActorType: "STAFF", TokenVersion: 1, Capabilities: []string{"LAB_TECH", "LAB_REVIEW"}, LeaseAction: "DI-007", LeaseExpiresAt: now.Add(time.Second)}
	in := domain.ResultCreateInput{Items: []domain.ResultItemInput{{TestCode: "CBC", ValueText: "medical-secret"}}}
	key := domain.NewID()
	r, err := s.CreateResult(ctx, p, o.ID, key, in)
	if err != nil {
		t.Fatal(err)
	}
	if r.Items[0].Unit != "g/L" || r.SpecimenID != o.Specimens[0].ID {
		t.Fatal("missing test snapshot or specimen")
	}
	replay, err := s.CreateResult(ctx, p, o.ID, key, in)
	if err != nil || replay.ID != r.ID {
		t.Fatalf("replay: %v", err)
	}
	p.LeaseAction = "DI-009"
	r, err = s.TransitionResult(ctx, p, r.ID, domain.NewID(), "DI-009", r.Version, "", domain.ResultMeta{CorrelationID: "test"})
	if err != nil {
		t.Fatal(err)
	}
	p.LeaseAction = "DI-011"
	if _, err = s.TransitionResult(ctx, p, r.ID, domain.NewID(), "DI-011", r.Version, "", domain.ResultMeta{CorrelationID: "test"}); domain.Code(err) != "FORBIDDEN" {
		t.Fatalf("self review accepted: %v", err)
	}
	p.UserID = b
	r, err = s.TransitionResult(ctx, p, r.ID, domain.NewID(), "DI-011", r.Version, "", domain.ResultMeta{CorrelationID: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if r.State != "PUBLISHED" || len(m.out) != 1 {
		t.Fatalf("invalid publication state or event count: %s %d", r.State, len(m.out))
	}
	patientPrincipal := domain.Principal{UserID: owner, ActorType: "PATIENT", TokenVersion: 3, LeaseAction: "DI-013", LeaseExpiresAt: now.Add(time.Second)}
	if err := m.Put(ctx, "access", owner, domain.Access{UserID: owner, ActorType: "PATIENT", Status: "ACTIVE", TokenVersion: 3}); err != nil {
		t.Fatal(err)
	}
	if err := m.Put(ctx, "result", r.ID, resultRecord{Result: r, Contributors: []string{a, b}}); err != nil {
		t.Fatal(err)
	}
	if err := m.Put(ctx, "result-order", o.ID, r.ID); err != nil {
		t.Fatal(err)
	}
	results, err := s.PublishedResults(ctx, patientPrincipal, patient, 1, 10)
	if err != nil || results.Total != 1 || len(results.Items) != 1 || results.Items[0].ID != r.ID {
		t.Fatalf("published result not returned to owner: %+v %v", results, err)
	}
	if _, err = s.PublishedResults(ctx, patientPrincipal, domain.NewID(), 1, 10); domain.Code(err) != "NOT_FOUND" {
		t.Fatalf("cross-patient read did not return not-found: %v", err)
	}
	doctor := domain.Principal{UserID: domain.NewID(), ActorType: "DOCTOR", TokenVersion: 1, LeaseAction: "DI-013", LeaseExpiresAt: now.Add(time.Second)}
	if err = m.Put(ctx, "access", doctor.UserID, domain.Access{UserID: doctor.UserID, ActorType: "DOCTOR", Status: "ACTIVE", TokenVersion: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.PublishedResults(ctx, doctor, patient, 1, 10); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("doctor read without a current grant was allowed: %v", err)
	}
	if m.out[0].RequestID != o.RequestID || strings.Contains(string(m.out[0].Payload), "medical-secret") {
		t.Fatalf("invalid publication: %s", m.out[0].Payload)
	}
	p.LeaseAction = "DI-008"
	if _, err = s.UpdateResult(ctx, p, r.ID, domain.NewID(), domain.ResultUpdateInput{Items: in.Items, ExpectedVersion: r.Version}); domain.Code(err) != "STATE_CONFLICT" {
		t.Fatalf("published result mutable: %v", err)
	}
}

func TestResultLeaseCheckedInsideTransaction(t *testing.T) {
	now := time.Now().UTC()
	m := &memory{objects: map[string]json.RawMessage{}}
	id := domain.NewID()
	_ = m.Put(context.Background(), "access", id, domain.Access{ActorType: "STAFF", Status: "ACTIVE", TokenVersion: 1, Capabilities: []string{"LAB_TECH"}})
	p := domain.Principal{UserID: id, ActorType: "STAFF", TokenVersion: 1, Capabilities: []string{"LAB_TECH"}, LeaseAction: "DI-008", LeaseExpiresAt: now}
	_, err := New(m, func() time.Time { return now }).UpdateResult(context.Background(), p, domain.NewID(), domain.NewID(), domain.ResultUpdateInput{ExpectedVersion: 1, Items: []domain.ResultItemInput{{TestCode: "CBC", ValueText: "1"}}})
	if domain.Code(err) != "AUTHZ_LEASE_EXPIRED" {
		t.Fatalf("expired lease accepted: %v", err)
	}
}

func TestDocumentedBearerOnlyResultActions(t *testing.T) {
	ctx := context.Background()
	id := domain.NewID()
	m := &memory{objects: map[string]json.RawMessage{}}
	_ = m.Put(ctx, "access", id, domain.Access{ActorType: "STAFF", Status: "ACTIVE", TokenVersion: 1, Capabilities: []string{"LAB_TECH", "LAB_REVIEW"}})
	s := New(m, time.Now)
	p := domain.Principal{UserID: id, ActorType: "STAFF", TokenVersion: 1, Capabilities: []string{"LAB_TECH", "LAB_REVIEW"}}
	for _, item := range []struct{ action, cap string }{{"DI-007", "LAB_TECH"}, {"DI-010", "LAB_REVIEW"}} {
		if err := s.resultAccess(ctx, m, p, item.action, item.cap); err != nil {
			t.Fatalf("Bearer-only %s rejected: %v", item.action, err)
		}
	}
	p.TokenVersion = 2
	if err := s.resultAccess(ctx, m, p, "DI-007", "LAB_TECH"); domain.Code(err) != "FORBIDDEN" {
		t.Fatalf("revoked token accepted: %v", err)
	}
}
