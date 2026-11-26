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

func TestGrantHeartbeatReusesWatermarkWithoutChangingAuthorityOrClearingGap(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	start := now
	store := &memory{objects: map[string]json.RawMessage{}}
	service := New(store, func() time.Time { return now })
	visit, patient, doctor := domain.NewID(), domain.NewID(), domain.NewID()
	receive := func(sequence int, mode string, active bool, at time.Time) error {
		fields := map[string]any{"mode": mode, "sequence": sequence}
		if mode == "CHECKPOINT" {
			fields["watermarkOnly"] = true
		} else if mode == "LEGACY_CHECKPOINT" {
			fields["mode"] = "CHECKPOINT"
		}
		aggregate := projection.VisitGrantStreamID
		if mode == "UPSERT" {
			aggregate = visit
			fields["visitId"] = visit
			fields["patientId"] = patient
			fields["doctorUserId"] = doctor
			fields["active"] = active
			fields["canCancel"] = active
		}
		payload, _ := json.Marshal(fields)
		return service.Handle(ctx, "umc.events.clinical.v1", "clinical.visit-doctor-grant-changed.v1", domain.Envelope{
			MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "VisitDoctorGrantChanged", SchemaVersion: 1, Producer: "clinical", AggregateID: aggregate, AggregateVersion: sequence, CorrelationID: "watermark-test", OccurredAt: at, Payload: payload,
		})
	}
	if err := receive(1, "UPSERT", true, now); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		now = now.Add(20 * time.Second)
		if err := receive(1, "CHECKPOINT", false, now); err != nil {
			t.Fatal("matching watermark heartbeat rejected", err)
		}
		if err := projection.RequireCurrentVisitStream(ctx, store, now); err != nil {
			t.Fatal("heartbeat did not refresh freshness", err)
		}
	}
	// The last UPSERT hash remains authoritative after any number of heartbeats.
	if err := receive(1, "UPSERT", true, start); err != nil {
		t.Fatal("heartbeat changed last data hash", err)
	}
	if err := receive(1, "CHECKPOINT", false, start); err != nil {
		t.Fatal(err)
	}
	if err := projection.RequireCurrentVisitStream(ctx, store, now); err != nil {
		t.Fatal("stale heartbeat regressed freshness", err)
	}
	if err := receive(2, "UPSERT", false, now); err != nil {
		t.Fatal(err)
	}
	if err := receive(2, "CHECKPOINT", false, now); err != nil {
		t.Fatal(err)
	}
	if err := receive(1, "UPSERT", true, start); err != nil {
		t.Fatal(err)
	}
	var grant projection.VisitGrantEvent
	if err := load(ctx, store, "visit_grant", visit, &grant); err != nil || grant.Active == nil || *grant.Active {
		t.Fatal("heartbeat/replay reopened revoked authority", err)
	}
	if err := receive(4, "CHECKPOINT", false, now); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatal("heartbeat skipped missing data", err)
	}
	now = now.Add(time.Second)
	if err := receive(2, "CHECKPOINT", false, now); err != nil {
		t.Fatal(err)
	}
	if err := projection.RequireCurrentVisitStream(ctx, store, now); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatal("heartbeat cleared an unresolved gap", err)
	}
	if err := receive(3, "UPSERT", false, now); err != nil {
		t.Fatal(err)
	}
	// Legacy incrementing checkpoints continue to work during the rollout.
	if err := receive(4, "LEGACY_CHECKPOINT", false, now); err != nil {
		t.Fatal(err)
	}
	if err := projection.RequireCurrentVisitStream(ctx, store, now); err != nil {
		t.Fatal(err)
	}
	now = now.Add(30 * time.Second)
	if err := projection.RequireCurrentVisitStream(ctx, store, now); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatal("expired heartbeat admitted authority", err)
	}
}

func TestWatermarkCannotStandInForAnUnappliedGrantOrRevocation(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	store := &memory{objects: map[string]json.RawMessage{}}
	service := New(store, func() time.Time { return now })
	visit, patient, doctor := domain.NewID(), domain.NewID(), domain.NewID()
	receive := func(sequence int, checkpoint, active bool) error {
		payload := map[string]any{"mode": "UPSERT", "sequence": sequence, "visitId": visit,
			"patientId": patient, "doctorUserId": doctor, "active": active, "canCancel": active}
		aggregate := visit
		if checkpoint {
			payload = map[string]any{"mode": "CHECKPOINT", "sequence": sequence, "watermarkOnly": true}
			aggregate = projection.VisitGrantStreamID
		}
		body, _ := json.Marshal(payload)
		return service.Handle(ctx, "umc.events.clinical.v1", "clinical.visit-doctor-grant-changed.v1", domain.Envelope{
			MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "VisitDoctorGrantChanged", SchemaVersion: 1,
			Producer: "clinical", AggregateID: aggregate, AggregateVersion: sequence,
			CorrelationID: "early-heartbeat-test", OccurredAt: now, Payload: body,
		})
	}
	for sequence := 1; sequence <= 2; sequence++ {
		if err := receive(sequence, true, false); domain.Code(err) != "SERVICE_UNAVAILABLE" {
			t.Fatal("early heartbeat must record a gap, even for the next sequence", err)
		}
		if err := projection.RequireCurrentVisitStream(ctx, store, now); domain.Code(err) != "SERVICE_UNAVAILABLE" {
			t.Fatal("missing grant/revocation must block authority", err)
		}
		if err := receive(sequence, false, sequence == 1); err != nil {
			t.Fatal("early heartbeat consumed the unapplied data sequence", err)
		}
		if err := receive(sequence, true, false); err != nil {
			t.Fatal(err)
		}
		if err := projection.RequireCurrentVisitStream(ctx, store, now); err != nil {
			t.Fatal("applied data and matching heartbeat must recover stream", err)
		}
	}
	var grant projection.VisitGrantEvent
	if err := load(ctx, store, "visit_grant", visit, &grant); err != nil || grant.Active == nil || *grant.Active {
		t.Fatal("revocation was skipped by the preceding heartbeat", err)
	}
}
