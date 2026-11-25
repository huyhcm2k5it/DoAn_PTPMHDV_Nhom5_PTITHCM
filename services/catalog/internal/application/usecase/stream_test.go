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
	store := &streamRecorder{pending: 45}
	s := NewStream(store)
	base := time.Now()
	published := 0
	send := func(context.Context, ports.Outgoing) error { published++; return nil }
	for _, dt := range []time.Duration{0, time.Second, 9 * time.Second, 10 * time.Second} {
		if err := s.Tick(context.Background(), base.Add(dt), send); err != nil {
			t.Fatal(err)
		}
	}
	if store.bootstrap != 1 || store.checkpoints != 2 || published != 45 {
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
