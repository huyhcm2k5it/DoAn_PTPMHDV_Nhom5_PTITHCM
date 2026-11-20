package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"umccare/diagnostic/internal/domain"
)

func TestSharedBillingTopicsIgnoreOtherSourceOwners(t *testing.T) {
	for _, source := range []string{"APPOINTMENT", "MED_HOLD"} {
		for _, typ := range []string{"ChargePrepared", "ChargePaid", "SettlementDecision"} {
			t.Run(source+"/"+typ, func(t *testing.T) {
				m := &memory{objects: map[string]json.RawMessage{}}
				s := New(m, time.Now)
				p := billingOwnershipPayload(typ, source)
				b, _ := json.Marshal(p)
				msg := domain.Envelope{MessageID: domain.NewID(), MessageType: typ, MessageKind: "EVENT", Producer: "billing", SchemaVersion: 1, AggregateID: domain.NewID(), AggregateVersion: 1, CorrelationID: "billing-owner-test", OccurredAt: time.Now(), Payload: b}
				route := map[string]string{"ChargePrepared": "billing.charge-prepared.v1", "ChargePaid": "billing.charge-paid.v1", "SettlementDecision": "billing.settlement-decision.v1"}[typ]
				if err := s.Handle(context.Background(), "umc.events.billing.v1", route, msg); err != nil {
					t.Fatalf("valid shared event should not create a retry or dead letter: %v", err)
				}
				if len(m.objects) != 0 || len(m.orders) != 0 || len(m.out) != 0 {
					t.Fatal("foreign payment mutated Diagnostic business data")
				}
			})
		}
	}
}

func TestLabBillingEvidenceStillRequiresOwnedOrder(t *testing.T) {
	for _, typ := range []string{"ChargePrepared", "ChargePaid"} {
		t.Run(typ, func(t *testing.T) {
			m := &memory{objects: map[string]json.RawMessage{}}
			b, _ := json.Marshal(billingOwnershipPayload(typ, "LAB_ORDER"))
			if err := New(m, time.Now).billing(context.Background(), m, domain.Envelope{MessageType: typ, Payload: b}); domain.Code(err) != "SERVICE_UNAVAILABLE" {
				t.Fatalf("missing explicit LAB source must retry: %v", err)
			}
		})
	}
}

type unavailableBillingOrders struct{ *memory }

func (unavailableBillingOrders) Order(context.Context, string) (domain.Order, error) {
	return domain.Order{}, errors.New("storage unavailable")
}

func TestSharedSettlementDoesNotAcknowledgeStorageFailure(t *testing.T) {
	m := &memory{objects: map[string]json.RawMessage{}}
	b, _ := json.Marshal(billingOwnershipPayload("SettlementDecision", "APPOINTMENT"))
	if err := New(m, time.Now).billing(context.Background(), unavailableBillingOrders{m}, domain.Envelope{MessageType: "SettlementDecision", Payload: b}); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("storage error must retry, not be treated as a foreign source: %v", err)
	}
}

func TestUnknownBillingSourceTypeIsInvalid(t *testing.T) {
	for _, typ := range []string{"ChargePrepared", "ChargePaid"} {
		m := &memory{objects: map[string]json.RawMessage{}}
		b, _ := json.Marshal(billingOwnershipPayload(typ, "UNKNOWN_OWNER"))
		if err := New(m, time.Now).billing(context.Background(), m, domain.Envelope{MessageType: typ, Payload: b}); domain.Code(err) != "INVALID_MESSAGE" {
			t.Fatalf("unknown source type accepted for %s: %v", typ, err)
		}
	}
}

func billingOwnershipPayload(typ, source string) map[string]any {
	switch typ {
	case "ChargePrepared":
		return map[string]any{"requestId": domain.NewID(), "sourceType": source, "sourceId": domain.NewID(), "sourceRevision": 1, "chargeId": domain.NewID(), "state": "CREATED"}
	case "ChargePaid":
		return map[string]any{"chargeId": domain.NewID(), "sourceType": source, "sourceId": domain.NewID(), "sourceRevision": 1, "settlementId": domain.NewID(), "transactionId": "TXN_FOREIGN", "fence": 1, "amountVND": 100000, "paidAt": time.Now()}
	default:
		// The current shared decision contract does not include sourceType.
		return map[string]any{"settlementId": domain.NewID(), "sourceId": domain.NewID(), "sourceRevision": 1, "decisionVersion": 1, "state": "FAILED"}
	}
}
