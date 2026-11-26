package usecase

import (
	"context"
	"errors"
	"testing"
	"time"
	"umccare/catalog/internal/application/ports"
)

type streamRecorder struct {
	bootstrap, checkpoints, drains, pending int
	bootstrapErr, checkpointErr             error
}

func (s *streamRecorder) BootstrapCatalogStream(context.Context) error {
	s.bootstrap++
	return s.bootstrapErr
}
func (s *streamRecorder) EnsureCheckpoint(context.Context, time.Time) error {
	s.checkpoints++
	return s.checkpointErr
}
func (s *streamRecorder) PublishPending(ctx context.Context, publish func(context.Context, ports.Outgoing) error) (bool, error) {
	s.drains++
	if s.pending == 0 {
		return false, nil
	}
	s.pending--
	return true, publish(ctx, ports.Outgoing{})
}
func TestStreamCadenceDoesNotRepeatBootstrapOrHeartbeatPerDrain(t *testing.T) {
	store := &streamRecorder{pending: 3}
	s := NewStream(store)
	base := time.Now()
	published := 0
	send := func(context.Context, ports.Outgoing) error { published++; return nil }
	for _, dt := range []time.Duration{0, time.Second, 9 * time.Second, 10 * time.Second} {
		if err := s.Tick(context.Background(), base.Add(dt), send); err != nil {
			t.Fatal(err)
		}
	}
	if store.bootstrap != 1 || store.checkpoints != 2 || published != 3 || store.drains != 4 {
		t.Fatalf("unexpected cadence/delivery: %+v published=%d", store, published)
	}
}
func TestStreamRetriesFailedBookkeepingBeforePublishing(t *testing.T) {
	failure := errors.New("database temporarily unavailable")
	store := &streamRecorder{bootstrapErr: failure, pending: 1}
	s := NewStream(store)
	now := time.Now()
	send := func(context.Context, ports.Outgoing) error { return nil }
	if err := s.Tick(context.Background(), now, send); !errors.Is(err, failure) || store.drains != 0 {
		t.Fatal("published before bootstrap", err)
	}
	store.bootstrapErr = nil
	store.checkpointErr = failure
	if err := s.Tick(context.Background(), now, send); !errors.Is(err, failure) || store.drains != 0 {
		t.Fatal("published before heartbeat", err)
	}
	store.checkpointErr = nil
	if err := s.Tick(context.Background(), now, send); err != nil || store.bootstrap != 2 || store.checkpoints != 2 || store.pending != 0 {
		t.Fatalf("bookkeeping did not recover: %+v %v", store, err)
	}
}

func TestTickYieldsAfterOneConfirmedDelivery(t *testing.T) {
	store := &streamRecorder{pending: 20}
	stream := NewStream(store)
	published := 0
	if err := stream.Tick(context.Background(), time.Now(), func(context.Context, ports.Outgoing) error {
		published++
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if published != 1 || store.pending != 19 {
		t.Fatalf("one slow tick must not start an unbounded series of remote transactions: published=%d pending=%d", published, store.pending)
	}
}
