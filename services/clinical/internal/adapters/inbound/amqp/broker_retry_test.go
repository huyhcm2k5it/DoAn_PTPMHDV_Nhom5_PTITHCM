package amqpadapter

import (
	"encoding/json"
	amqp "github.com/rabbitmq/amqp091-go"
	"testing"
	"time"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

func TestRetryEnvelopeRejectsSpoofedOrUnboundedAttempts(t *testing.T) {
	now := time.Now()
	item := ports.BrokerRetry{SchemaVersion: 1, Service: "clinical", NotBefore: now.Add(time.Second),
		Input: ports.Incoming{MessageID: domain.NewID(), RetryToken: domain.NewID(), Attempt: 1, Body: []byte(`{}`)}}
	raw, _ := json.Marshal(item)
	if _, err := decodeRetry(amqp.Delivery{MessageId: item.Input.RetryToken, Body: raw}, now); err != nil {
		t.Fatal(err)
	}
	if _, err := decodeRetry(amqp.Delivery{MessageId: domain.NewID(), Body: raw}, now); err == nil {
		t.Fatal("spoofed token accepted")
	}
	item.Input.Attempt = 4
	raw, _ = json.Marshal(item)
	if _, err := decodeRetry(amqp.Delivery{MessageId: item.Input.RetryToken, Body: raw}, now); err == nil {
		t.Fatal("unbounded retry accepted")
	}
}
