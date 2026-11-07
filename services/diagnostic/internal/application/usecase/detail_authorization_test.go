package usecase

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"umccare/diagnostic/internal/domain"
)

func TestDoctorDetailRequiresCurrentVisitGrantBeforeReturningPublishedResults(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	m := &memory{objects: map[string]json.RawMessage{}}
	doctor := domain.NewID()
	doctorID := domain.NewID()
	orderID := domain.NewID()
	visitID := domain.NewID()
	resultID := domain.NewID()
	if err := m.Put(ctx, "access", doctor, domain.Access{UserID: doctor, ActorType: "DOCTOR", Status: "ACTIVE", TokenVersion: 1}); err != nil {
		t.Fatal(err)
	}
	if err := m.Put(ctx, "DOCTOR", doctorID, map[string]any{"identityUserId": doctor}); err != nil {
		t.Fatal(err)
	}
	o := domain.Order{ID: orderID, DoctorID: doctorID, VisitID: visitID, State: "PUBLISHED", Version: 2}
	m.orders = []domain.Order{o}
	published := domain.Result{ID: resultID, OrderID: orderID, State: "PUBLISHED", Items: []domain.ResultItem{{ResultItemInput: domain.ResultItemInput{TestCode: "CBC", ValueText: "sensitive-value"}}}}
	if err := m.Put(ctx, "result-order", orderID, resultID); err != nil {
		t.Fatal(err)
	}
	if err := m.Put(ctx, "result", resultID, resultRecord{Result: published}); err != nil {
		t.Fatal(err)
	}
	p := domain.Principal{UserID: doctor, ActorType: "DOCTOR", TokenVersion: 1}

	if _, err := New(m, func() time.Time { return now }).Detail(ctx, p, orderID); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("doctor received published result without current grant projection: %v", err)
	}

	detail, err := New(grantStore{m}, func() time.Time { return now }).Detail(ctx, p, orderID)
	if err != nil || len(detail.Results) != 1 || detail.Results[0].ID != resultID {
		t.Fatalf("current visit grant did not permit assigned doctor detail: %+v %v", detail, err)
	}
}
