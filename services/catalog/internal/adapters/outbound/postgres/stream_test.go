package postgres

import (
	"encoding/json"
	"testing"
	"time"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
)

func TestCatalogChangedEnvelopeCanonical(t *testing.T) {
	price := domain.Price{PriceVersionID: "00000000-0000-4000-8000-000000000501", ItemType: "LAB", ItemID: "00000000-0000-4000-8000-000000000401", Revision: 3, AmountVND: 125000, EffectiveFrom: time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC)}
	e := ports.Changed{MessageID: "00000000-0000-4000-8000-000000000601", CorrelationID: "catalog-test", RequestID: "00000000-0000-4000-8000-000000000602", OccurredAt: time.Date(2026, 11, 5, 1, 0, 0, 0, time.UTC), Price: price, Sequence: 12}
	raw, err := buildCatalogChangedEnvelope(e)
	if err != nil {
		t.Fatal(err)
	}
	var message struct {
		MessageKind      string `json:"messageKind"`
		MessageType      string `json:"messageType"`
		SchemaVersion    int    `json:"schemaVersion"`
		Producer         string `json:"producer"`
		AggregateID      string `json:"aggregateId"`
		AggregateVersion int    `json:"aggregateVersion"`
		CausationID      string `json:"causationId"`
		RequestID        string `json:"requestId"`
		Payload          struct {
			EntityType     string `json:"entityType"`
			EntityID       string `json:"entityId"`
			EntityVersion  int    `json:"entityVersion"`
			StreamSequence int64  `json:"streamSequence"`
			Mode           string `json:"mode"`
			Snapshot       struct {
				ItemID   string `json:"itemId"`
				Revision int    `json:"revision"`
			} `json:"fullSnapshot"`
		} `json:"payload"`
	}
	if err = json.Unmarshal(raw, &message); err != nil {
		t.Fatal(err)
	}
	if message.MessageKind != "EVENT" || message.MessageType != "CatalogChanged" || message.SchemaVersion != 1 || message.Producer != "catalog" {
		t.Fatalf("noncanonical envelope: %+v", message)
	}
	if message.AggregateID != price.ItemID || message.AggregateVersion != price.Revision || message.CausationID != e.RequestID || message.RequestID != e.RequestID {
		t.Fatalf("envelope IDs/version mismatch: %+v", message)
	}
	if message.Payload.EntityType != "PRICE_VERSION" || message.Payload.EntityID != price.PriceVersionID || message.Payload.EntityVersion != price.Revision || message.Payload.StreamSequence != 12 || message.Payload.Mode != "UPSERT" || message.Payload.Snapshot.ItemID != price.ItemID || message.Payload.Snapshot.Revision != price.Revision {
		t.Fatalf("payload mismatch: %+v", message.Payload)
	}
}
