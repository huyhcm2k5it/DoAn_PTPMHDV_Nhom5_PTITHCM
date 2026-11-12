package usecase

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"umccare/diagnostic/internal/application/projection"
	"umccare/diagnostic/internal/domain"
)

func TestVisitGrantStreamRejectsGapsAndExpires(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	store := &memory{objects: map[string]json.RawMessage{}}
	s := New(store, func() time.Time { return now })
	visit, patient, doctor := domain.NewID(), domain.NewID(), domain.NewID()
	receive := func(id string, seq int, fields map[string]any) error {
		fields["sequence"] = seq
		payload, _ := json.Marshal(fields)
		return s.Handle(ctx, "umc.events.clinical.v1", "clinical.visit-doctor-grant-changed.v1", domain.Envelope{
			MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "VisitDoctorGrantChanged",
			SchemaVersion: 1, Producer: "clinical", AggregateID: id, AggregateVersion: seq,
			CorrelationID: "visit-grant-test", OccurredAt: now, Payload: payload,
		})
	}
	checkpoint := func(seq int) error {
		return receive(projection.VisitGrantStreamID, seq, map[string]any{"mode": "CHECKPOINT"})
	}
	assignment := func(seq int, active, canCancel bool) error {
		return receive(visit, seq, map[string]any{
			"mode": "UPSERT", "visitId": visit, "patientId": patient, "doctorUserId": doctor,
			"active": active, "canCancel": canCancel,
		})
	}
	if err := checkpoint(1); err != nil {
		t.Fatal(err)
	}
	if err := checkpoint(3); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("checkpoint accepted across gap: %v", err)
	}
	if err := projection.RequireCurrentVisitStream(ctx, store, now); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("authorization accepted across gap: %v", err)
	}
	if err := assignment(2, true, true); err != nil {
		t.Fatal(err)
	}
	if err := checkpoint(3); err != nil {
		t.Fatal(err)
	}
	if err := projection.RequireCurrentVisitStream(ctx, store, now); err != nil {
		t.Fatal(err)
	}
	if err := assignment(4, true, false); err != nil {
		t.Fatal(err)
	}
	if err := assignment(5, false, false); err != nil {
		t.Fatal(err)
	}
	if err := assignment(2, true, true); err != nil {
		t.Fatal(err)
	}
	var grant projection.VisitGrantEvent
	if err := load(ctx, store, "visit_grant", visit, &grant); err != nil || grant.Active == nil || *grant.Active {
		t.Fatalf("stale assignment reopened a revoked grant: %+v, %v", grant, err)
	}
	now = now.Add(30 * time.Second)
	if err := projection.RequireCurrentVisitStream(ctx, store, now); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("stale checkpoint allowed authorization: %v", err)
	}
}
