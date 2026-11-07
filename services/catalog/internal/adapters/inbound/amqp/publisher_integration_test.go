//go:build brokerintegration

package amqpadapter

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
)

func TestCatalogPublishRequiresConfirmAndRoute(t *testing.T) {
	url := os.Getenv("TEST_RABBITMQ_URL")
	if url == "" {
		t.Fatal("TEST_RABBITMQ_URL must refer to an isolated test broker")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
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
	exchange := "umc.test.catalog." + domain.NewID()
	if err = ch.ExchangeDeclare(exchange, "topic", false, true, false, false, nil); err != nil {
		t.Fatal(err)
	}
	defer ch.ExchangeDelete(exchange, false, false)
	queue, err := ch.QueueDeclare("", false, true, true, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = ch.QueueBind(queue.Name, "catalog.test", exchange, false, nil); err != nil {
		t.Fatal(err)
	}
	publisher, err := NewPublisher(ch)
	if err != nil {
		t.Fatal(err)
	}
	id := domain.NewID()
	if err = publisher.Publish(ctx, ports.Outgoing{MessageID: id, Exchange: exchange, RoutingKey: "catalog.test", Body: []byte(`{"test":true}`)}); err != nil {
		t.Fatal(err)
	}
	delivery, ok, err := ch.Get(queue.Name, false)
	if err != nil || !ok || delivery.MessageId != id || delivery.DeliveryMode != 2 {
		t.Fatal(delivery, ok, err)
	}
	if err = delivery.Ack(false); err != nil {
		t.Fatal(err)
	}
	if err = publisher.Publish(ctx, ports.Outgoing{MessageID: domain.NewID(), Exchange: exchange, RoutingKey: "unbound", Body: []byte(`{}`)}); !errors.Is(err, ErrUnroutable) {
		t.Fatal("mandatory return ignored", err)
	}
}
