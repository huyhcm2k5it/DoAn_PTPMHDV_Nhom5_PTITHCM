//go:build brokerintegration

package amqpadapter

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

func TestRealMandatoryPublishConfirmAndDelivery(t *testing.T) {
	url := os.Getenv("TEST_RABBITMQ_URL")
	if url == "" {
		t.Fatal("TEST_RABBITMQ_URL must refer to an isolated test broker")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	conn, e := Dial(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	defer conn.Close()
	ch, e := conn.Channel()
	if e != nil {
		t.Fatal(e)
	}
	defer ch.Close()
	exchange := "umc.test.clinical." + domain.NewID()
	if e = ch.ExchangeDeclare(exchange, "topic", false, true, false, false, nil); e != nil {
		t.Fatal(e)
	}
	defer ch.ExchangeDelete(exchange, false, false)
	q, e := ch.QueueDeclare("", false, true, true, false, nil)
	if e != nil {
		t.Fatal(e)
	}
	if e = ch.QueueBind(q.Name, "test.route", exchange, false, nil); e != nil {
		t.Fatal(e)
	}
	publisher, e := NewPublisher(ch)
	if e != nil {
		t.Fatal(e)
	}
	id := domain.NewID()
	if e = publisher.Publish(ctx, ports.Outgoing{MessageID: id, Exchange: exchange, RoutingKey: "test.route", Body: []byte(`{"test":true}`)}); e != nil {
		t.Fatal(e)
	}
	delivery, ok, e := ch.Get(q.Name, false)
	if e != nil || !ok || delivery.MessageId != id || delivery.DeliveryMode != 2 {
		t.Fatal(delivery, ok, e)
	}
	if e = delivery.Ack(false); e != nil {
		t.Fatal(e)
	}
	if e = publisher.Publish(ctx, ports.Outgoing{MessageID: domain.NewID(), Exchange: exchange, RoutingKey: "unbound", Body: []byte(`{}`)}); !errors.Is(e, ErrUnroutable) {
		t.Fatal("mandatory return ignored", e)
	}
}
