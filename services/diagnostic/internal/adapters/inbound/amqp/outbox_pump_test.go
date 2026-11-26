package amqpadapter

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
	"umccare/diagnostic/internal/application/ports"
)

type pumpStore struct {
	publish func(context.Context, func(context.Context, ports.Outgoing) error) (bool, error)
}

func (s pumpStore) PublishPending(ctx context.Context, send func(context.Context, ports.Outgoing) error) (bool, error) {
	return s.publish(ctx, send)
}
func (s pumpStore) Quarantine(context.Context, ports.Incoming, string) error { return nil }

func TestOutboxPumpStopJoinsInflightPublish(t *testing.T) {
	started, exited := make(chan struct{}), make(chan struct{})
	store := pumpStore{publish: func(ctx context.Context, send func(context.Context, ports.Outgoing) error) (bool, error) {
		return false, send(ctx, ports.Outgoing{})
	}}
	failures, stop := startOutboxPump(context.Background(), store, func(ctx context.Context, _ ports.Outgoing) error {
		close(started)
		<-ctx.Done()
		close(exited)
		return ctx.Err()
	})
	defer stop()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("publisher did not start independently")
	}
	stopped := make(chan struct{})
	go func() { stop(); close(stopped) }()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not cancel and join publisher")
	}
	select {
	case <-exited:
	default:
		t.Fatal("publisher was not joined before channel close")
	}
	select {
	case err := <-failures:
		t.Fatal("normal shutdown reported failure", err)
	default:
	}
}
func TestOutboxPumpPropagatesStorageFailure(t *testing.T) {
	failure := errors.New("database unavailable")
	store := pumpStore{publish: func(context.Context, func(context.Context, ports.Outgoing) error) (bool, error) {
		return false, failure
	}}
	failures, stop := startOutboxPump(context.Background(), store, nil)
	defer stop()
	select {
	case err := <-failures:
		if !errors.Is(err, failure) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("worker would continue with a failed publisher")
	}
}
func TestOutboxPumpBacksOffEmptyAndUnroutableWork(t *testing.T) {
	for _, err := range []error{nil, ErrUnroutable} {
		t.Run(map[bool]string{true: "unroutable", false: "empty"}[err != nil], func(t *testing.T) {
			var calls atomic.Int32
			started := make(chan struct{})
			store := pumpStore{publish: func(context.Context, func(context.Context, ports.Outgoing) error) (bool, error) {
				if calls.Add(1) == 1 {
					close(started)
				}
				return false, err
			}}
			_, stop := startOutboxPump(context.Background(), store, nil)
			defer stop()
			select {
			case <-started:
			case <-time.After(time.Second):
				t.Fatal("publisher did not start")
			}
			<-time.After(50 * time.Millisecond)
			stop()
			if calls.Load() != 1 {
				t.Fatal("empty/unroutable outbox busy-polled", calls.Load())
			}
		})
	}
}
func TestOutboxPumpDrainsConfirmedRowsWithoutConsumerTicks(t *testing.T) {
	var deliveries atomic.Int32
	drained := make(chan struct{})
	store := pumpStore{publish: func(ctx context.Context, send func(context.Context, ports.Outgoing) error) (bool, error) {
		if deliveries.Load() >= 3 {
			return false, nil
		}
		if err := send(ctx, ports.Outgoing{}); err != nil {
			return false, err
		}
		if deliveries.Add(1) == 3 {
			close(drained)
		}
		return true, nil
	}}
	_, stop := startOutboxPump(context.Background(), store, func(context.Context, ports.Outgoing) error { return nil })
	defer stop()
	select {
	case <-drained:
	case <-time.After(time.Second):
		t.Fatal("confirmed work waited for consumer ticks")
	}
}
