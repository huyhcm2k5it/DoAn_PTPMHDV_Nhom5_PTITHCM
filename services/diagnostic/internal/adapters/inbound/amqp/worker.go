package amqpadapter

import (
	"context"
	"encoding/json"
	"errors"
	amqp "github.com/rabbitmq/amqp091-go"
	"log/slog"
	"net"
	"sync"
	"time"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

var ErrUnroutable = errors.New("mandatory publish was returned")

type deadlineConn struct{ net.Conn }

func (c deadlineConn) Write(b []byte) (int, error) {
	if e := c.SetWriteDeadline(time.Now().Add(5 * time.Second)); e != nil {
		return 0, e
	}
	return c.Conn.Write(b)
}
func Dial(ctx context.Context, url string) (*amqp.Connection, error) {
	return amqp.DialConfig(url, amqp.Config{Heartbeat: 10 * time.Second, Dial: func(network, address string) (net.Conn, error) {
		c, e := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, address)
		if e != nil {
			return nil, e
		}
		return deadlineConn{c}, nil
	}})
}

type Publisher struct {
	ch       *amqp.Channel
	returned <-chan amqp.Return
	mu       sync.Mutex
}

func NewPublisher(ch *amqp.Channel) (*Publisher, error) {
	if e := ch.Confirm(false); e != nil {
		return nil, e
	}
	return &Publisher{ch: ch, returned: ch.NotifyReturn(make(chan amqp.Return, 1))}, nil
}
func (p *Publisher) Publish(ctx context.Context, m ports.Outgoing) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	confirm, e := p.ch.PublishWithDeferredConfirmWithContext(ctx, m.Exchange, m.RoutingKey, true, false, amqp.Publishing{ContentType: "application/json", DeliveryMode: amqp.Persistent, MessageId: m.MessageID, Timestamp: time.Now().UTC(), Body: m.Body})
	if e != nil {
		return e
	}
	ack, e := confirm.WaitContext(ctx)
	if e != nil {
		return e
	}
	if !ack {
		return errors.New("publisher negatively acknowledged")
	}
	// AMQP dispatch delivers basic.return before the confirm for that publish.
	select {
	case _, open := <-p.returned:
		if !open {
			return errors.New("publisher channel closed")
		}
		return ErrUnroutable
	default:
		return nil
	}
}

type Store interface {
	PublishPending(context.Context, func(context.Context, ports.Outgoing) error) (bool, error)
	Quarantine(context.Context, ports.Incoming, string) error
}
type Receiver interface {
	Receive(context.Context, ports.Incoming) error
}

// DeclareOwned is opt-in for local setup. QuÃ¢n owns the shared topology; foreign
// producer exchanges must already exist and are never declared here.
func DeclareOwned(ch *amqp.Channel) error {
	for _, exchange := range []string{"umc.events.diagnostic.v1", "umc.commands.diagnostic.v1", "umc.deadletters.diagnostic.v1"} {
		if e := ch.ExchangeDeclare(exchange, "topic", true, false, false, false, nil); e != nil {
			return e
		}
	}
	for _, queue := range []string{"evt.diagnostic.v1", "cmd.diagnostic.v1"} {
		if _, e := ch.QueueDeclare(queue, true, false, false, false, amqp.Table{"x-queue-type": "quorum"}); e != nil {
			return e
		}
	}
	for _, binding := range [][3]string{
		{"umc.commands.clinical.v1", "diagnostic.create-lab-order.v1", "cmd.diagnostic.v1"},
		{"umc.commands.billing.v1", "diagnostic.reserve-settlement.v1", "cmd.diagnostic.v1"},
		{"umc.events.billing.v1", "billing.charge-prepared.v1", "evt.diagnostic.v1"},
		{"umc.events.billing.v1", "billing.charge-paid.v1", "evt.diagnostic.v1"},
		{"umc.events.billing.v1", "billing.settlement-decision.v1", "evt.diagnostic.v1"},
		{"umc.events.billing.v1", "billing.billing-status-changed.v1", "evt.diagnostic.v1"},
		{"umc.events.catalog.v1", "catalog.catalog-changed.v1", "evt.diagnostic.v1"},
		{"umc.events.identity.v1", "identity.identity-access-changed.v1", "evt.diagnostic.v1"},
		{"umc.events.patient.v1", "patient.patient-access-changed.v1", "evt.diagnostic.v1"},
		{"umc.events.clinical.v1", "clinical.visit-doctor-grant-changed.v1", "evt.diagnostic.v1"},
	} {
		if e := ch.QueueBind(binding[2], binding[1], binding[0], false, nil); e != nil {
			return e
		}
	}

	if _, e := ch.QueueDeclare("dlq.diagnostic.v1", true, false, false, false, amqp.Table{"x-queue-type": "quorum"}); e != nil {
		return e
	}
	return ch.QueueBind("dlq.diagnostic.v1", "diagnostic.quarantine.v1", "umc.deadletters.diagnostic.v1", false, nil)
}
func Run(ctx context.Context, url string, store Store, receiver Receiver, declare bool) error {
	conn, e := Dial(ctx, url)
	if e != nil {
		return e
	}
	defer conn.Close()
	pubCh, e := conn.Channel()
	if e != nil {
		return e
	}
	defer pubCh.Close()
	publisher, e := NewPublisher(pubCh)
	if e != nil {
		return e
	}
	inCh, e := conn.Channel()
	if e != nil {
		return e
	}
	defer inCh.Close()
	if declare {
		if e = DeclareOwned(inCh); e != nil {
			return e
		}
	}
	if e = inCh.Qos(10, 0, false); e != nil {
		return e
	}
	deliveries, e := inCh.Consume("evt.diagnostic.v1", "", false, false, false, false, nil)
	if e != nil {
		return e
	}
	commands, e := inCh.Consume("cmd.diagnostic.v1", "", false, false, false, false, nil)
	if e != nil {
		return e
	}
	mergeCtx, stopMerge := context.WithCancel(ctx)
	defer stopMerge()
	deliveries = mergeDeliveries(mergeCtx, deliveries, commands)
	retryErrors, stopRetries, err := startBrokerRetries(ctx, conn, receiver.Receive, store.Quarantine)
	if err != nil {
		return err
	}
	defer stopRetries()

	pumpErrors, stopPump := startOutboxPump(ctx, store, publisher.Publish)
	defer stopPump()
	publisherClosed := pubCh.NotifyClose(make(chan *amqp.Error, 1))
	for {
		select {
		case <-ctx.Done():
			return nil
		case retryErr := <-retryErrors:
			return retryErr
		case pumpErr := <-pumpErrors:
			return pumpErr
		case <-publisherClosed:
			return errors.New("publisher channel closed")

		case d, open := <-deliveries:
			if !open {
				return errors.New("consumer channel closed")
			}
			call, cancel := context.WithTimeout(ctx, 10*time.Second)
			e = receiver.Receive(call, ports.Incoming{MessageID: d.MessageId, Exchange: d.Exchange, RoutingKey: d.RoutingKey, Body: d.Body})
			cancel()
			if e != nil {
				return e
			}
			if e = d.Ack(false); e != nil {
				return e
			}
			var envelope domain.Envelope
			if json.Unmarshal(d.Body, &envelope) == nil {
				slog.Info("Diagnostic delivery recorded", "messageId", envelope.MessageID, "messageType", envelope.MessageType, "correlationId", envelope.CorrelationID)
			}

		}
	}
}

func mergeDeliveries(ctx context.Context, events, commands <-chan amqp.Delivery) <-chan amqp.Delivery {
	out := make(chan amqp.Delivery)
	go func() {
		defer close(out)
		for {
			var delivery amqp.Delivery
			var ok bool
			select {
			case <-ctx.Done():
				return
			case delivery, ok = <-events:
				if !ok {
					return
				}
			case delivery, ok = <-commands:
				if !ok {
					return
				}
			}
			select {
			case out <- delivery:
			case <-ctx.Done():
				return
			}
		}
	}()
	return out
}

// The dedicated publisher never holds up the event consumer. Shutdown cancels
// and joins it before Run closes the AMQP publisher channel.
func startOutboxPump(parent context.Context, store Store, publish func(context.Context, ports.Outgoing) error) (<-chan error, func()) {
	ctx, cancel := context.WithCancel(parent)
	errors := make(chan error, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := runOutboxPump(ctx, store, publish); err != nil && ctx.Err() == nil {
			errors <- err
		}
	}()
	return errors, func() { cancel(); <-done }
}

func runOutboxPump(ctx context.Context, store Store, publish func(context.Context, ports.Outgoing) error) error {
	timer := time.NewTimer(0)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-timer.C:
		}

		// Bound each delivery individually; a long batch must not starve the
		// heartbeat or consumer. Drain immediately only after a confirmed row.
		call, cancel := context.WithTimeout(ctx, 5*time.Second)
		sent, err := store.PublishPending(call, publish)
		cancel()
		delay := time.Duration(0)
		if errors.Is(err, ErrUnroutable) {
			delay = 5 * time.Second
			slog.Warn("Diagnostic outbox waiting for target binding")
		} else if err != nil {
			return err
		} else if !sent {
			delay = time.Second
		}
		timer.Reset(delay)
	}
}
