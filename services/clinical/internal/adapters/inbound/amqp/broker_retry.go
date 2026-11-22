package amqpadapter

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

const retryExchange = "umc.retry.clinical.v1"
const retryQueue = "retry.clinical.v1"

// The broker keeps each delayed delivery unacknowledged. A restart requeues it
// with the same NotBefore and token, without relying on a lossy TTL/DLX hop.
func declareRetry(ch *amqp.Channel) error {
	if err := ch.ExchangeDeclare(retryExchange, "direct", true, false, false, false, nil); err != nil {
		return err
	}
	if _, err := ch.QueueDeclare(retryQueue, true, false, false, false, amqp.Table{
		"x-queue-type": "quorum", "x-delivery-limit": int32(-1),
	}); err != nil {
		return err
	}
	return ch.QueueBind(retryQueue, "retry", retryExchange, false, nil)
}

func decodeRetry(d amqp.Delivery, now time.Time) (ports.BrokerRetry, error) {
	var item ports.BrokerRetry
	if len(d.Body) > 2<<20 || json.Unmarshal(d.Body, &item) != nil || item.SchemaVersion != 1 || item.Service != "clinical" ||
		!domain.ValidID(item.Input.MessageID) || !domain.ValidID(item.Input.RetryToken) || d.MessageId != item.Input.RetryToken ||
		item.Input.Attempt < 1 || item.Input.Attempt > 3 || len(item.Input.Body) > 1<<20 ||
		item.NotBefore.IsZero() || item.NotBefore.After(now.Add(5*time.Minute)) {
		return item, errors.New("invalid internal broker retry")
	}
	return item, nil
}

// Dedicated bounded prefetch prevents delayed retries from blocking normal input.
// stop cancels timers, closes the channel and joins all consumers before return.
func startBrokerRetries(parent context.Context, conn *amqp.Connection,
	receive func(context.Context, ports.Incoming) error,
	quarantine func(context.Context, ports.Incoming, string) error,
) (<-chan error, func(), error) {
	ch, err := conn.Channel()
	if err != nil {
		return nil, nil, err
	}
	if err = declareRetry(ch); err != nil {
		ch.Close()
		return nil, nil, err
	}
	if err = ch.Qos(8, 0, false); err != nil {
		ch.Close()
		return nil, nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	deliveries, err := ch.ConsumeWithContext(ctx, retryQueue, "", false, false, false, false, nil)
	if err != nil {
		cancel()
		ch.Close()
		return nil, nil, err
	}
	failures := make(chan error, 1)
	done := make(chan struct{})
	var jobs sync.WaitGroup
	// Timers may wait in parallel; database handlers run one at a time.
	processing := make(chan struct{}, 1)
	report := func(e error) {
		if e != nil && ctx.Err() == nil {
			select {
			case failures <- e:
			default:
			}
		}
	}
	go func() {
		defer close(done)
		for {
			select {
			case <-ctx.Done():
				return
			case delivery, open := <-deliveries:
				if !open {
					report(errors.New("retry consumer channel closed"))
					return
				}
				jobs.Add(1)
				go func(d amqp.Delivery) {
					defer jobs.Done()
					item, decodeErr := decodeRetry(d, time.Now())
					if decodeErr == nil {
						timer := time.NewTimer(max(time.Until(item.NotBefore), 0))
						defer timer.Stop()
						select {
						case <-ctx.Done():
							return
						case <-timer.C:
						}
					}
					select {
					case processing <- struct{}{}:
					case <-ctx.Done():
						return
					}
					defer func() { <-processing }()
					call, finish := context.WithTimeout(ctx, 10*time.Second)
					defer finish()
					var e error
					if decodeErr != nil {
						e = quarantine(call, ports.Incoming{MessageID: d.MessageId, Exchange: d.Exchange, RoutingKey: d.RoutingKey, Body: d.Body}, "INVALID_RETRY_MESSAGE")
					} else {
						e = receive(call, item.Input)
					}
					if e == nil {
						e = d.Ack(false)
					}
					report(e)
				}(delivery)
			}
		}
	}()
	stop := func() { cancel(); ch.Close(); <-done; jobs.Wait() }
	return failures, stop, nil
}
