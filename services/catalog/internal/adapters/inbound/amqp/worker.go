package amqpadapter

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
)

var ErrUnroutable = errors.New("mandatory publish was returned")

type deadlineConn struct{ net.Conn }

func (c deadlineConn) Write(b []byte) (int, error) {
	if err := c.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return 0, err
	}
	return c.Conn.Write(b)
}
func Dial(ctx context.Context, url string) (*amqp.Connection, error) {
	return amqp.DialConfig(url, amqp.Config{Heartbeat: 10 * time.Second, Dial: func(network, address string) (net.Conn, error) {
		conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, address)
		if err != nil {
			return nil, err
		}
		return deadlineConn{conn}, nil
	}})
}

type Publisher struct {
	ch       *amqp.Channel
	returned <-chan amqp.Return
	mu       sync.Mutex
}

func NewPublisher(ch *amqp.Channel) (*Publisher, error) {
	if err := ch.Confirm(false); err != nil {
		return nil, err
	}
	return &Publisher{ch: ch, returned: ch.NotifyReturn(make(chan amqp.Return, 1))}, nil
}
func (p *Publisher) Publish(ctx context.Context, m ports.Outgoing) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	confirm, err := p.ch.PublishWithDeferredConfirmWithContext(ctx, m.Exchange, m.RoutingKey, true, false, amqp.Publishing{ContentType: "application/json", DeliveryMode: amqp.Persistent, MessageId: m.MessageID, Timestamp: time.Now().UTC(), Body: m.Body})
	if err != nil {
		return err
	}
	ack, err := confirm.WaitContext(ctx)
	if err != nil {
		return err
	}
	if !ack {
		return errors.New("publisher negatively acknowledged")
	}
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
	ApplyIdentityAccessChanged(context.Context, string, string, string, []byte) error
	QuarantineIdentity(context.Context, string, string, string, string, []byte) error
}
type Stream interface {
	Tick(context.Context, time.Time, func(context.Context, ports.Outgoing) error) error
}

func DeclareOwned(ch *amqp.Channel) error {
	if err := ch.ExchangeDeclare("umc.events.catalog.v1", "topic", true, false, false, false, nil); err != nil {
		return err
	}
	if _, err := ch.QueueDeclare("evt.catalog.v1", true, false, false, false, amqp.Table{"x-queue-type":"quorum"}); err != nil {
		return err
	}
	return ch.QueueBind("evt.catalog.v1", "identity.identity-access-changed.v1", "umc.events.identity.v1", false, nil)
}

func Run(ctx context.Context, url string, store Store, stream Stream, declare bool) error {
	conn, err := Dial(ctx, url)
	if err != nil {
		return err
	}
	defer conn.Close()
	pubCh, err := conn.Channel()
	if err != nil {
		return err
	}
	defer pubCh.Close()
	publisher, err := NewPublisher(pubCh)
	if err != nil {
		return err
	}
	inCh, err := conn.Channel()
	if err != nil {
		return err
	}
	defer inCh.Close()
	if declare {
		if err = DeclareOwned(inCh); err != nil {
			return err
		}
	}
	if err = inCh.Qos(10, 0, false); err != nil {
		return err
	}
	deliveries, err := inCh.ConsumeWithContext(ctx, "evt.catalog.v1", "", false, false, false, false, nil)
	if err != nil {
		return err
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case d, open := <-deliveries:
			if !open {
				return errors.New("Catalog consumer channel closed")
			}
			call, cancel := context.WithTimeout(ctx, 10*time.Second)
			err = store.ApplyIdentityAccessChanged(call, d.Exchange, d.RoutingKey, d.MessageId, d.Body)
			if err != nil {
				var envelope struct {
					MessageID string `json:"messageId"`
				}
				_ = json.Unmarshal(d.Body, &envelope)
				if code := errorCode(err); code == "INVALID_MESSAGE" || code == "STATE_CONFLICT" {
					qerr := store.QuarantineIdentity(call, envelope.MessageID, d.Exchange, d.RoutingKey, code, d.Body)
					cancel()
					if qerr != nil {
						return qerr
					}
					if err = d.Ack(false); err != nil {
						return err
					}
					continue
				}
				cancel()
				_ = d.Nack(false, true)
				return err
			}
			cancel()
			if err = d.Ack(false); err != nil {
				return err
			}
		case now := <-ticker.C:
			call, cancel := context.WithTimeout(ctx, 10*time.Second)
			err = stream.Tick(call, now.UTC(), publisher.Publish)
			cancel()
			if err != nil {
				slog.Error("Catalog stream tick failed", "error", err)
				continue
			}
		}
	}
}

func errorCode(err error) string { return domain.Code(err) }
func sameID(a, b string) bool {
	return domain.ValidID(a) && domain.ValidID(b) && strings.EqualFold(a, b)
}
