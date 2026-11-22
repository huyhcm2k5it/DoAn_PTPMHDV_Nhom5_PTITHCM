//go:build brokerintegration

package amqpadapter

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

// This suite requires a private test vhost with no application worker attached.
func TestBrokerRetrySurvivesConsumerRestartAndHonorsDelay(t *testing.T) {
	url := os.Getenv("TEST_RABBITMQ_URL")
	if url == "" {
		t.Fatal("TEST_RABBITMQ_URL must refer to an isolated test broker")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	conn, err := Dial(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ch, err := conn.Channel()
	if err != nil {
		t.Fatal(err)
	}
	defer ch.Close()
	if err = declareRetry(ch); err != nil {
		t.Fatal(err)
	}
	defer ch.ExchangeDelete(retryExchange, false, false)
	defer ch.QueueDelete(retryQueue, false, false, false)
	received := make(chan ports.Incoming, 2)
	receive := func(_ context.Context, in ports.Incoming) error { received <- in; return nil }
	quarantine := func(context.Context, ports.Incoming, string) error {
		t.Error("valid retry was quarantined")
		return nil
	}
	failures, stop, err := startBrokerRetries(ctx, conn, receive, quarantine)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { stop() }()
	item := ports.BrokerRetry{SchemaVersion: 1, Service: "clinical", NotBefore: time.Now().Add(8 * time.Second),
		Input: ports.Incoming{MessageID: domain.NewID(), RetryToken: domain.NewID(), Attempt: 1, Body: []byte(`{"test":true}`)}}
	body, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	publisher, err := NewPublisher(ch)
	if err != nil {
		t.Fatal(err)
	}
	if err = publisher.Publish(ctx, ports.Outgoing{MessageID: item.Input.RetryToken, Exchange: retryExchange, RoutingKey: "retry", Body: body}); err != nil {
		t.Fatal(err)
	}
	// Wait until the first consumer has an unacknowledged message, then restart it.
	for {
		q, e := ch.QueueInspect(retryQueue)
		if e != nil {
			t.Fatal(e)
		}
		if q.Messages == 0 {
			break
		}
		select {
		case e = <-failures:
			t.Fatal(e)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(20 * time.Millisecond):
		}
	}
	stop()
	stop() // Repeated shutdown must be safe before reusing the connection.
	stop = func() {}
	select {
	case <-received:
		t.Fatal("retry executed before consumer restart")
	default:
	}
	nextFailures, nextStop, err := startBrokerRetries(ctx, conn, receive, quarantine)
	if err != nil {
		t.Fatal(err)
	}
	failures, stop = nextFailures, nextStop
	select {
	case got := <-received:
		if time.Now().Before(item.NotBefore) || got.RetryToken != item.Input.RetryToken || string(got.Body) != string(item.Input.Body) {
			t.Fatal("retry changed its token/body or executed before NotBefore")
		}
	case e := <-failures:
		t.Fatal(e)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	stop()
	stop() // Repeated shutdown must be safe before reusing the connection.
	stop = func() {}
	// If the callback returned but the ACK lost the race with stop, redelivery is
	// valid and the PostgreSQL inbox token test guarantees idempotent processing.
}
