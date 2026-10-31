package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

type fakeHandler struct {
	err   error
	calls int
}

func (f *fakeHandler) HandleClaim(context.Context, string, domain.Envelope) error {
	f.calls++
	return f.err
}
func (f *fakeHandler) HandleProjection(context.Context, string, domain.Envelope) error {
	f.calls++
	return f.err
}

type fakeDeliveryStore struct {
	scheduled, dead int
	err             error
	next            int
	delay           time.Duration
}

func (f *fakeDeliveryStore) ScheduleRetry(_ context.Context, _ ports.Incoming, next int, delay time.Duration) error {
	f.scheduled++
	f.next = next
	f.delay = delay
	return f.err
}
func (f *fakeDeliveryStore) Quarantine(context.Context, ports.Incoming, string) error {
	f.dead++
	return f.err
}
func validDelivery() ports.Incoming {
	e := domain.Envelope{MessageID: domain.NewID(), MessageType: "QueueTicketClaimed"}
	raw, _ := json.Marshal(e)
	return ports.Incoming{MessageID: e.MessageID, Exchange: "umc.events.appointment.v1", RoutingKey: "appointment.queue-ticket-claimed.v1", Body: raw}
}
func TestReceiveCommitsRetryBeforeAcknowledgement(t *testing.T) {
	store := &fakeDeliveryStore{}
	handler := &fakeHandler{err: errors.New("database unavailable")}
	r := NewReceiver(handler, store)
	delivery := validDelivery()
	if e := r.Receive(context.Background(), delivery); e != nil {
		t.Fatal(e)
	}
	if store.scheduled != 1 || store.next != 1 || store.delay < 5*time.Second || store.delay > 6*time.Second {
		t.Fatal(store)
	}
	store.err = errors.New("retry DB unavailable")
	if e := r.Receive(context.Background(), delivery); e == nil {
		t.Fatal("would ack without durable retry")
	}
	delivery.Attempt = 3
	delivery.LeaseID = domain.NewID()
	store.err = nil
	if e := r.Receive(context.Background(), delivery); e != nil || store.dead != 1 {
		t.Fatal(store, e)
	}
}
func TestReceiveQuarantinesSpoofAndMalformedWithoutRunningHandler(t *testing.T) {
	for _, d := range []ports.Incoming{{Body: []byte("broken")}, func() ports.Incoming { d := validDelivery(); d.Exchange = "umc.events.billing.v1"; return d }(), func() ports.Incoming { d := validDelivery(); d.MessageID = domain.NewID(); return d }()} {
		store := &fakeDeliveryStore{}
		handler := &fakeHandler{}
		r := NewReceiver(handler, store)
		if e := r.Receive(context.Background(), d); e != nil || handler.calls != 0 || store.dead != 1 {
			t.Fatal(store, handler, e)
		}
	}
}
func TestReceiveRejectsUnknownEnvelopeFieldsAndNegativeAttempt(t *testing.T) {
	for _, d := range []ports.Incoming{func() ports.Incoming {
		d := validDelivery()
		d.Body = append(d.Body[:len(d.Body)-1], []byte(`,"unexpected":true}`)...)
		return d
	}(), func() ports.Incoming { d := validDelivery(); d.Attempt = -1; return d }()} {
		store := &fakeDeliveryStore{}
		handler := &fakeHandler{}
		r := NewReceiver(handler, store)
		if err := r.Receive(context.Background(), d); err != nil || store.dead != 1 || handler.calls != 0 {
			t.Fatal("invalid delivery was handled", store, handler, err)
		}
	}
}
