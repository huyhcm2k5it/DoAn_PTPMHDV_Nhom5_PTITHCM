package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

type unavailableStore struct {
	*memory
	failure error
}

func (s *unavailableStore) Within(context.Context, string, func(ports.Tx) error) error {
	return s.failure
}

type deliveryRecorder struct{ retries, dead int }

func (d *deliveryRecorder) ScheduleRetry(context.Context, ports.Incoming, int, time.Duration) error {
	d.retries++
	return nil
}
func (d *deliveryRecorder) Quarantine(context.Context, ports.Incoming, string) error {
	d.dead++
	return nil
}
func TestReceiverDistinguishesInfrastructureAndBusinessFailures(t *testing.T) {
	for _, attempt := range []int{0, 3} {
		for _, infrastructure := range []bool{true, false} {
			failure := error(domain.Fail("SERVICE_UNAVAILABLE", "projection unavailable"))
			if infrastructure {
				failure = context.DeadlineExceeded
			}
			store := &unavailableStore{memory: &memory{}, failure: failure}
			delivery := &deliveryRecorder{}
			now := time.Now()
			envelope := domain.Envelope{MessageID: domain.NewID(), MessageKind: "EVENT", MessageType: "CatalogChanged", SchemaVersion: 1, Producer: "catalog", AggregateID: domain.NewID(), AggregateVersion: 1, CorrelationID: "receiver-test", OccurredAt: now, Payload: json.RawMessage(`{}`)}
			raw, _ := json.Marshal(envelope)
			in := ports.Incoming{MessageID: envelope.MessageID, Exchange: "umc.events.catalog.v1", RoutingKey: "catalog.catalog-changed.v1", Body: raw, Attempt: attempt}
			if attempt > 0 {
				in.RetryToken = domain.NewID()
			}
			err := NewReceiver(New(store, func() time.Time { return now }), delivery).Receive(context.Background(), in)
			if infrastructure {
				if !errors.Is(err, failure) || delivery.dead != 0 || delivery.retries != 0 {
					t.Fatalf("infrastructure failure lost delivery: %v %+v", err, delivery)
				}
			} else if err != nil || (attempt == 0 && delivery.retries != 1) || (attempt == 3 && delivery.dead != 1) {
				t.Fatalf("business retry policy changed: %v %+v", err, delivery)
			}
		}
	}
}
