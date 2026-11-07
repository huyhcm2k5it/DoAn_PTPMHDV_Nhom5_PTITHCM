package usecase

import (
	"context"
	"time"

	"umccare/catalog/internal/application/ports"
)

type StreamStore interface {
	BootstrapCatalogStream(context.Context) error
	EnsureCheckpoint(context.Context, time.Time) error
	ports.PublisherStore
}

type Stream struct{ store StreamStore }

func NewStream(store StreamStore) *Stream { return &Stream{store: store} }

// Tick bootstraps once, maintains the heartbeat, and drains a bounded outbox batch.
func (s *Stream) Tick(ctx context.Context, now time.Time, publish func(context.Context, ports.Outgoing) error) error {
	if err := s.store.BootstrapCatalogStream(ctx); err != nil {
		return err
	}
	if err := s.store.EnsureCheckpoint(ctx, now); err != nil {
		return err
	}
	for i := 0; i < 20; i++ {
		sent, err := s.store.PublishPending(ctx, publish)
		if err != nil {
			return err
		}
		if !sent {
			break
		}
	}
	return nil
}
