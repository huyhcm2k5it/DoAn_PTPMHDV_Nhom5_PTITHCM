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

// Tick has one owner: the publisher pump. Bootstrap and heartbeat bookkeeping
// do not need a database transaction on every 250 ms drain tick.
type Stream struct {
	store          StreamStore
	bootstrapped   bool
	nextCheckpoint time.Time
}

func NewStream(store StreamStore) *Stream { return &Stream{store: store} }

// Tick bootstraps once, maintains the heartbeat, and confirms one outbox row.
// A batch of remote database transactions can exhaust the worker deadline after
// successful deliveries. One row per tick keeps heartbeat bookkeeping timely;
// the ticker is already ready again when an online operation exceeds 250 ms.
func (s *Stream) Tick(ctx context.Context, now time.Time, publish func(context.Context, ports.Outgoing) error) error {
	if !s.bootstrapped {
		if err := s.store.BootstrapCatalogStream(ctx); err != nil {
			return err
		}
		s.bootstrapped = true
	}
	if !now.Before(s.nextCheckpoint) {
		if err := s.store.EnsureCheckpoint(ctx, now); err != nil {
			return err
		}
		s.nextCheckpoint = now.Add(10 * time.Second)
	}
	_, err := s.store.PublishPending(ctx, publish)
	return err
}
