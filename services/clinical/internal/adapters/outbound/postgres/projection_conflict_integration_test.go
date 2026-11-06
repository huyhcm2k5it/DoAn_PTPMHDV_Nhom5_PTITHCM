//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

func TestAccessProjectionSameVersionConflictQuarantined(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	app := usecase.New(db, time.Now)
	receiver := usecase.NewReceiver(app, db)
	for _, kind := range []string{"identity", "patient"} {
		t.Run(kind, func(t *testing.T) {
			id := domain.NewID()
			owner := domain.NewID()
			event := domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", SchemaVersion: 1, Producer: kind, AggregateID: id, AggregateVersion: 2, CorrelationID: domain.NewID(), CausationID: domain.NewID(), RequestID: domain.NewID(), OccurredAt: time.Now().UTC()}
			exchange, routing := "umc.events.identity.v1", "identity.identity-access-changed.v1"
			payload := map[string]any{"userId": id, "actorType": "DOCTOR", "status": "ACTIVE", "tokenVersion": 1, "version": 2, "capabilities": []string{}, "phoneVerified": true}
			event.MessageType = "IdentityAccessChanged"
			if kind == "patient" {
				exchange, routing = "umc.events.patient.v1", "patient.patient-access-changed.v1"
				event.MessageType = "PatientAccessChanged"
				payload = map[string]any{"patientId": id, "ownerUserId": owner, "active": true, "policyVersion": 2}
			}
			event.Payload, _ = json.Marshal(payload)
			if err := app.HandleProjection(ctx, exchange, event); err != nil {
				t.Fatal(err)
			}
			// Redelivery with a new message ID but equivalent projected state is safe.
			event.MessageID = domain.NewID()
			if err := app.HandleProjection(ctx, exchange, event); err != nil {
				t.Fatal("identical version rejected", err)
			}
			// A competing same-version revocation/ownership update must be quarantined.
			if kind == "identity" {
				payload["status"] = "DISABLED"
			} else {
				payload["ownerUserId"] = domain.NewID()
				payload["active"] = false
			}
			event.MessageID = domain.NewID()
			event.Payload, _ = json.Marshal(payload)
			if err := app.HandleProjection(ctx, exchange, event); domain.Code(err) != "INVALID_MESSAGE" {
				t.Fatalf("same-version conflict accepted: %v", err)
			}
			body, _ := json.Marshal(event)
			if err := receiver.Receive(ctx, ports.Incoming{MessageID: event.MessageID, Exchange: exchange, RoutingKey: routing, Body: body}); err != nil {
				t.Fatal("quarantine failed", err)
			}
			var reason string
			if err := db.pool.QueryRow(ctx, `SELECT reason_code FROM dead_letters WHERE message_id=$1`, event.MessageID).Scan(&reason); err != nil || reason != "INVALID_MESSAGE" {
				t.Fatalf("conflict was not quarantined: reason=%q err=%v", reason, err)
			}
			var processed bool
			if err := db.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM inbox WHERE message_id=$1 AND status='PROCESSED')`, event.MessageID).Scan(&processed); err != nil || processed {
				t.Fatalf("conflict marked processed: %v %v", processed, err)
			}
			// A newer version remains able to revoke the old access.
			event.MessageID = domain.NewID()
			event.AggregateVersion = 3
			if kind == "identity" {
				payload["version"] = 3
			} else {
				payload["policyVersion"] = 3
			}
			event.Payload, _ = json.Marshal(payload)
			if err := app.HandleProjection(ctx, exchange, event); err != nil {
				t.Fatal("newer projection rejected", err)
			}
		})
	}
}
