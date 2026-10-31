package domain

import (
	"testing"
	"time"
)

func TestStartNormalizesUUIDAndRejectsInvalidVersion(t *testing.T) {
	in := StartInput{TicketID: "AAAAAAAA-0000-0000-0000-000000000001", DoctorID: "bbbbbbbb-0000-0000-0000-000000000002", ExpectedTicketVersion: 1}
	if err := in.Validate(); err != nil {
		t.Fatal(err)
	}
	if in.TicketID != "aaaaaaaa-0000-0000-0000-000000000001" {
		t.Fatal(in.TicketID)
	}
	in.ExpectedTicketVersion = 0
	if Code(in.Validate()) != "VALIDATION_ERROR" {
		t.Fatal("nonpositive version accepted")
	}
}

func TestDraftRequiresAllFieldsAllowsEmptyAndRejectsSignedOrStale(t *testing.T) {
	empty := ""
	in := DraftInput{Symptoms: &empty, Findings: &empty, Assessment: &empty, Diagnosis: &empty, ExpectedVersion: 1}
	if err := in.Validate(); err != nil {
		t.Fatal(err)
	}
	v := Visit{ID: NewID(), DoctorUserID: "doctor", State: "IN_PROGRESS", Version: 1}
	if err := v.CanDraft("doctor", 1); err != nil {
		t.Fatal(err)
	}
	if Code(v.CanDraft("other", 1)) != "FORBIDDEN" {
		t.Fatal("other doctor")
	}
	if Code(v.CanDraft("doctor", 2)) != "VISIT_VERSION_CONFLICT" {
		t.Fatal("stale")
	}
	v.State = "SIGNED"
	if Code(v.CanDraft("doctor", 1)) != "VISIT_ALREADY_SIGNED" {
		t.Fatal("signed")
	}
	in.Diagnosis = nil
	if Code(in.Validate()) != "VALIDATION_ERROR" {
		t.Fatal("missing field accepted")
	}
}

func TestClaimRejectsSpoofedProducerAndMalformedAcceptedPayload(t *testing.T) {
	payload := ClaimResult{RequestID: NewID(), TicketID: NewID(), AppointmentID: NewID(), PatientID: NewID(), ClaimID: NewID(), State: "ACCEPTED"}
	e := Envelope{MessageID: NewID(), MessageKind: "EVENT", MessageType: "QueueTicketClaimed", SchemaVersion: 1, Producer: "appointment", AggregateID: payload.TicketID, AggregateVersion: 1, CorrelationID: NewID(), CausationID: NewID(), RequestID: payload.RequestID, OccurredAt: time.Now().UTC()}
	if err := e.ValidateClaim("umc.events.appointment.v1", payload); err != nil {
		t.Fatal(err)
	}
	if Code(e.ValidateClaim("umc.events.billing.v1", payload)) != "INVALID_MESSAGE" {
		t.Fatal("spoofed exchange accepted")
	}
	payload.ClaimID = ""
	if Code(e.ValidateClaim("umc.events.appointment.v1", payload)) != "INVALID_MESSAGE" {
		t.Fatal("accepted without claim")
	}
}
