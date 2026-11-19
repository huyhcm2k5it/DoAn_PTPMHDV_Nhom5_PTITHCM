package amqpadapter

import (
	"context"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

func TestMergeDeliveriesExitsWhenEitherConsumerCloses(t *testing.T) {
	for _, stopped := range []string{"events", "commands"} {
		t.Run(stopped, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			events := make(chan amqp.Delivery)
			commands := make(chan amqp.Delivery)
			if stopped == "events" {
				close(events)
			} else {
				close(commands)
			}

			select {
			case _, open := <-mergeDeliveries(ctx, events, commands):
				if open {
					t.Fatal("expected merged channel to close")
				}
			case <-time.After(time.Second):
				t.Fatal("worker did not notice that a consumer closed")
			}
		})
	}
}
