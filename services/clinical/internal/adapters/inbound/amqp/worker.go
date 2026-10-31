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
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
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
	DueRetries(context.Context, int) ([]ports.Incoming, error)
	CompleteRetry(context.Context, ports.Incoming) error
}
type Receiver interface {
	Receive(context.Context, ports.Incoming) error
}

// DeclareOwned is opt-in for local setup. Quân owns the shared topology; foreign
// producer exchanges must already exist and are never declared here.
func DeclareOwned(ch *amqp.Channel) error {
	for _, exchange := range []string{"umc.commands.clinical.v1", "umc.deadletters.clinical.v1"} {
		if e := ch.ExchangeDeclare(exchange, "topic", true, false, false, false, nil); e != nil {
			return e
		}
	}
	if _, e := ch.QueueDeclare("evt.clinical.v1", true, false, false, false, nil); e != nil {
		return e
	}
	for _, binding := range [][2]string{{"umc.events.appointment.v1", "appointment.queue-ticket-claimed.v1"}, {"umc.events.identity.v1", "identity.identity-access-changed.v1"}, {"umc.events.patient.v1", "patient.patient-access-changed.v1"}} {
		if e := ch.QueueBind("evt.clinical.v1", binding[1], binding[0], false, nil); e != nil {
			return e
		}
	}
	if _, e := ch.QueueDeclare("dlq.clinical.v1", true, false, false, false, nil); e != nil {
		return e
	}
	return ch.QueueBind("dlq.clinical.v1", "clinical.quarantine.v1", "umc.deadletters.clinical.v1", false, nil)
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
	deliveries, e := inCh.ConsumeWithContext(ctx, "evt.clinical.v1", "", false, false, false, false, nil)
	if e != nil {
		return e
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	nextPublish := time.Time{}
	for {
		select {
		case <-ctx.Done():
			return nil
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
				slog.Info("Clinical delivery recorded", "messageId", envelope.MessageID, "messageType", envelope.MessageType, "correlationId", envelope.CorrelationID)
			}
		case <-ticker.C:
			if !time.Now().Before(nextPublish) {
				for i := 0; i < 20; i++ {
					call, cancel := context.WithTimeout(ctx, 5*time.Second)
					var sent bool
					sent, e = store.PublishPending(call, publisher.Publish)
					cancel()
					if errors.Is(e, ErrUnroutable) {
						nextPublish = time.Now().Add(5 * time.Second)
						slog.Warn("Clinical outbox waiting for target binding")
						break
					}
					if e != nil {
						return e
					}
					if !sent {
						break
					}
				}
			}
			call, cancel := context.WithTimeout(ctx, 5*time.Second)
			jobs, err := store.DueRetries(call, 5)
			cancel()
			if err != nil {
				return err
			}
			for _, job := range jobs {
				call, cancel := context.WithTimeout(ctx, 10*time.Second)
				err = receiver.Receive(call, job)
				if err == nil {
					err = store.CompleteRetry(call, job)
				}
				cancel()
				if err != nil {
					return err
				}
			}
		}
	}
}
