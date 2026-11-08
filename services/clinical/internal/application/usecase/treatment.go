package usecase

import (
	"context"
	"encoding/json"
	"strings"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

func treatment(tx ports.ClinicalTx) (ports.TreatmentTx, error) {
	t, ok := tx.(ports.TreatmentTx)
	if !ok {
		return nil, domain.Fail("SERVICE_UNAVAILABLE", "Treatment store unavailable")
	}
	return t, nil
}
func replay[T any](ctx context.Context, tx ports.ClinicalTx, p domain.Principal, op, key, hash string, out *T) (bool, error) {
	raw, h, found, e := tx.Replay(ctx, domain.ID(p.UserID), op, domain.ID(key))
	if e != nil || !found {
		return false, e
	}
	if h != hash {
		return true, domain.Fail("IDEMPOTENCY_CONFLICT", "Key belongs to another request")
	}
	return true, json.Unmarshal(raw, out)
}
func validMutation(id, key string) error {
	if !domain.ValidID(id) || !domain.ValidID(key) {
		return domain.Fail("VALIDATION_ERROR", "UUID ID and Idempotency-Key required")
	}
	return nil
}
func doctorVisit(ctx context.Context, tx ports.ClinicalTx, p domain.Principal, id string) (domain.Visit, error) {
	v, e := tx.Visit(ctx, domain.ID(id))
	if e != nil {
		return v, e
	}
	if v.DoctorUserID != domain.ID(p.UserID) {
		return v, domain.Fail("FORBIDDEN", "Visit belongs to another doctor")
	}
	return v, nil
}
func (s *Service) event(v domain.Visit, typ, kind string, payload any, meta domain.Meta) domain.Envelope {
	if meta.CorrelationID == "" {
		meta.CorrelationID = domain.NewID()
	}
	if !domain.ValidID(meta.RequestID) {
		meta.RequestID = domain.NewID()
	}
	raw, _ := json.Marshal(payload)
	return domain.Envelope{MessageID: domain.NewID(), MessageKind: kind, MessageType: typ, SchemaVersion: 1, Producer: "clinical", AggregateID: v.ID, AggregateVersion: v.Version, CorrelationID: meta.CorrelationID, CausationID: meta.RequestID, RequestID: meta.RequestID, OccurredAt: s.now().UTC(), Payload: raw}
}
func (s *Service) RequestLab(ctx context.Context, p domain.Principal, id, key string, input domain.LabInput, meta domain.Meta) (out domain.LabPending, err error) {
	if err = validMutation(id, key); err != nil {
		return
	}
	if err = input.Validate(); err != nil {
		return
	}
	for i := range input.Tests {
		input.Tests[i].TestID = domain.ID(input.Tests[i].TestID)
	}
	hash := domain.Hash(struct {
		ID    string
		Input domain.LabInput
	}{domain.ID(id), input})
	err = s.store.Within(ctx, "visit:"+domain.ID(id), func(base ports.ClinicalTx) error {
		if e := authorize(ctx, base, p, "DOCTOR"); e != nil {
			return e
		}
		tx, e := treatment(base)
		if e != nil {
			return e
		}
		if found, e := replay(ctx, tx, p, "CL-005", key, hash, &out); e != nil || found {
			return e
		}
		v, e := doctorVisit(ctx, tx, p, id)
		if e != nil {
			return e
		}
		if v.State != "IN_PROGRESS" && v.State != "LAB_REQUEST_PENDING" && v.State != "WAITING_LAB" {
			return domain.Fail("VISIT_NOT_ACTIVE", "Visit does not permit new LAB requests")
		}
		prior, e := tx.LabRequests(ctx, v.ID)
		if e != nil {
			return e
		}
		if input.ReplacesRequestID != "" {
			replaced, e := tx.LabRequest(ctx, domain.ID(input.ReplacesRequestID))
			if e != nil {
				return e
			}
			if replaced.VisitID != v.ID || (replaced.State != "REJECTED" && replaced.State != "FAILED") || replaced.SourceVersion != input.ExpectedSourceVersion {
				return domain.Fail("STATE_CONFLICT", "LAB replacement revision or state changed")
			}
			replaced.State = "SUPERSEDED"
			// Persist actor, intent and new request correlation in the existing replay and registry transaction.
			replaced.ReasonCode += "|RESUBMITTED:" + domain.ID(key)
			if e = tx.SaveLabRequest(ctx, replaced); e != nil {
				return e
			}
		}
		for _, request := range prior {
			if request.RequestID == domain.ID(input.ReplacesRequestID) || request.State == "SUPERSEDED" || len(request.Tests) != len(input.Tests) {
				continue
			}
			same := true
			for _, selection := range input.Tests {
				found := false
				for _, test := range request.Tests {
					if test.TestID == selection.TestID && test.Revision == selection.Revision {
						found = true
						break
					}
				}
				if !found {
					same = false
					break
				}
			}
			if same {
				return domain.Fail("LAB_REQUEST_DUPLICATE", "The same active LAB selection is already registered")
			}
		}
		tests := []domain.TestSnapshot{}
		for _, selection := range input.Tests {
			test, e := tx.LabTest(ctx, selection.TestID)
			if e != nil {
				return e
			}
			if test.Status != "ACTIVE" || test.Revision != selection.Revision {
				return domain.Fail("STATE_CONFLICT", "Test is unavailable or revision changed")
			}
			tests = append(tests, domain.TestSnapshot{TestID: test.ID, Revision: test.Revision, Code: test.Code, Name: test.Name, Unit: test.Unit, ReferenceRange: test.ReferenceRange})
		}
		doctor, e := tx.DoctorID(ctx, v.ID)
		if e != nil {
			return e
		}
		requestID := domain.NewID()
		command := domain.CreateLabOrder{RequestID: requestID, VisitID: v.ID, PatientID: v.PatientID, DoctorID: doctor, TestSnapshot: tests, AuthorizedAt: s.now().UTC()}
		command.RequestHash = command.Hash()
		request := domain.LabRequest{RequestID: requestID, VisitID: v.ID, State: "PENDING", Tests: tests, RequestHash: command.RequestHash}
		if e = tx.SaveLabRequest(ctx, request); e != nil {
			return e
		}
		v.State = "LAB_REQUEST_PENDING"
		v.Version++
		if e = tx.UpdateVisit(ctx, v); e != nil {
			return e
		}
		message := s.event(v, "CreateLabOrder", "COMMAND", command, meta)
		message.RequestID = requestID
		message.AggregateID = requestID
		message.AggregateVersion = 1
		if e = tx.AppendMessage(ctx, message, "umc.commands.clinical.v1", "diagnostic.create-lab-order.v1"); e != nil {
			return e
		}
		out = domain.LabPending{RequestID: requestID, State: "PENDING", StatusURL: "/api/v1/visits/" + v.ID}
		return tx.SaveReplay(ctx, domain.ID(p.UserID), "CL-005", domain.ID(key), hash, out)
	})
	return
}
func resolveLines(ctx context.Context, tx ports.TreatmentTx, lines []domain.PrescriptionLine) ([]domain.PrescriptionLine, error) {
	out := make([]domain.PrescriptionLine, len(lines))
	for i, line := range lines {
		m, e := tx.Medicine(ctx, line.MedicineCode)
		if e != nil {
			return nil, e
		}
		if m.Status != "ACTIVE" {
			return nil, domain.Fail("STATE_CONFLICT", "Medicine is inactive")
		}
		line.NameSnapshot = m.Name
		out[i] = line
	}
	return out, nil
}
func (s *Service) CreatePrescription(ctx context.Context, p domain.Principal, id, key string, input domain.PrescriptionInput) (out domain.Prescription, err error) {
	if err = validMutation(id, key); err != nil {
		return
	}
	if err = input.Validate(false); err != nil {
		return
	}
	hash := domain.Hash(struct {
		ID    string
		Input domain.PrescriptionInput
	}{domain.ID(id), input})
	err = s.store.Within(ctx, "visit:"+domain.ID(id), func(base ports.ClinicalTx) error {
		if e := authorize(ctx, base, p, "DOCTOR"); e != nil {
			return e
		}
		tx, e := treatment(base)
		if e != nil {
			return e
		}
		if found, e := replay(ctx, tx, p, "CL-006", key, hash, &out); e != nil || found {
			return e
		}
		v, e := doctorVisit(ctx, tx, p, id)
		if e != nil {
			return e
		}
		if v.State == "SIGNED" {
			return domain.Fail("STATE_CONFLICT", "Visit already signed")
		}
		lines, e := resolveLines(ctx, tx, input.Lines)
		if e != nil {
			return e
		}
		out = domain.Prescription{ID: domain.NewID(), VisitID: v.ID, PatientID: v.PatientID, State: "DRAFT", Version: 1, Revision: 1, Lines: lines}
		if e = tx.SavePrescription(ctx, out); e != nil {
			return e
		}
		return tx.SaveReplay(ctx, domain.ID(p.UserID), "CL-006", domain.ID(key), hash, out)
	})
	return
}
func (s *Service) mutatePrescription(ctx context.Context, p domain.Principal, id, key, op string, version int, input any, fn func(ports.TreatmentTx, domain.Visit, *domain.Prescription) error) (out domain.Prescription, err error) {
	if err = validMutation(id, key); err != nil {
		return
	}
	if err = (domain.VersionInput{ExpectedVersion: version}).Validate(); err != nil {
		return
	}
	hash := domain.Hash(struct {
		ID    string
		Input any
	}{domain.ID(id), input})
	err = s.store.Within(ctx, "prescription:"+domain.ID(id), func(base ports.ClinicalTx) error {
		if e := authorize(ctx, base, p, "DOCTOR"); e != nil {
			return e
		}
		tx, e := treatment(base)
		if e != nil {
			return e
		}
		if found, e := replay(ctx, tx, p, op, key, hash, &out); e != nil || found {
			return e
		}
		rx, e := tx.Prescription(ctx, domain.ID(id))
		if e != nil {
			return e
		}
		v, e := doctorVisit(ctx, tx, p, rx.VisitID)
		if e != nil {
			return e
		} // Lock visit before mutation; every prescription writer uses same visit row.
		rx, e = tx.Prescription(ctx, domain.ID(id))
		if e != nil {
			return e
		}
		if rx.State != "DRAFT" || rx.Version != version {
			return domain.Fail("STATE_CONFLICT", "Prescription changed or is immutable")
		}
		if e = fn(tx, v, &rx); e != nil {
			return e
		}
		rx.Version++
		rx.Revision++
		if e = tx.SavePrescription(ctx, rx); e != nil {
			return e
		}
		out = rx
		return tx.SaveReplay(ctx, domain.ID(p.UserID), op, domain.ID(key), hash, out)
	})
	return
}
func (s *Service) UpdatePrescription(ctx context.Context, p domain.Principal, id, key string, input domain.PrescriptionInput) (domain.Prescription, error) {
	if e := input.Validate(true); e != nil {
		return domain.Prescription{}, e
	}
	return s.mutatePrescription(ctx, p, id, key, "CL-007", input.ExpectedVersion, input, func(tx ports.TreatmentTx, v domain.Visit, rx *domain.Prescription) error {
		if v.State == "SIGNED" {
			return domain.Fail("STATE_CONFLICT", "Signed visit draft is frozen")
		}
		lines, e := resolveLines(ctx, tx, input.Lines)
		rx.Lines = lines
		return e
	})
}
func (s *Service) DeletePrescription(ctx context.Context, p domain.Principal, id, key string, input domain.VersionInput) (map[string]string, error) {
	rx, e := s.mutatePrescription(ctx, p, id, key, "CL-008", input.ExpectedVersion, input, func(tx ports.TreatmentTx, v domain.Visit, rx *domain.Prescription) error {
		if v.State == "SIGNED" {
			return domain.Fail("STATE_CONFLICT", "Signed visit draft is frozen")
		}
		rx.State = "DELETED"
		return nil
	})
	if e != nil {
		return nil, e
	}
	return map[string]string{"prescriptionId": rx.ID, "state": rx.State}, nil
}
func (s *Service) FinalizePrescription(ctx context.Context, p domain.Principal, id, key string, input domain.VersionInput, meta domain.Meta) (domain.Prescription, error) {
	if p.LeaseAction != "CL-009" || !p.LeaseExpiresAt.After(s.now()) {
		return domain.Prescription{}, domain.Fail("AUTHZ_LEASE_EXPIRED", "Current CL-009 lease required")
	}
	return s.mutatePrescription(ctx, p, id, key, "CL-009", input.ExpectedVersion, input, func(tx ports.TreatmentTx, v domain.Visit, rx *domain.Prescription) error {
		if v.State != "SIGNED" || len(rx.Lines) == 0 {
			return domain.Fail("STATE_CONFLICT", "Signed visit and nonempty prescription required")
		}
		all, e := tx.Prescriptions(ctx, v.ID)
		if e != nil {
			return e
		}
		for _, other := range all {
			if other.State == "FINAL" {
				return domain.Fail("STATE_CONFLICT", "Visit already has a FINAL prescription")
			}
		}
		now := s.now().UTC()
		if !p.LeaseExpiresAt.After(now) {
			return domain.Fail("AUTHZ_LEASE_EXPIRED", "Signing lease expired while waiting for the visit")
		}
		rx.State = "FINAL"
		rx.FinalizedAt = &now
		event := s.event(v, "PrescriptionFinalized", "EVENT", map[string]any{"prescriptionId": rx.ID, "revision": rx.Revision + 1, "visitId": v.ID, "patientId": v.PatientID, "itemsSnapshot": rx.Lines, "finalizedAt": now}, meta)
		event.AggregateID = rx.ID
		event.AggregateVersion = rx.Revision + 1
		return tx.AppendMessage(ctx, event, "umc.events.clinical.v1", "clinical.prescription-finalized.v1")
	})
}
func (s *Service) Complete(ctx context.Context, p domain.Principal, id, key string, input domain.VersionInput, meta domain.Meta) (out domain.DraftResult, err error) {
	if err = validMutation(id, key); err != nil {
		return
	}
	if err = input.Validate(); err != nil {
		return
	}
	if p.LeaseAction != "CL-010" || !p.LeaseExpiresAt.After(s.now()) {
		return out, domain.Fail("AUTHZ_LEASE_EXPIRED", "Current CL-010 lease required")
	}
	hash := domain.Hash(struct {
		ID    string
		Input domain.VersionInput
	}{domain.ID(id), input})
	err = s.store.Within(ctx, "visit:"+domain.ID(id), func(base ports.ClinicalTx) error {
		if e := authorize(ctx, base, p, "DOCTOR"); e != nil {
			return e
		}
		tx, e := treatment(base)
		if e != nil {
			return e
		}
		if found, e := replay(ctx, tx, p, "CL-010", key, hash, &out); e != nil || found {
			return e
		}
		v, e := doctorVisit(ctx, tx, p, id)
		if e != nil {
			return e
		}
		if e = v.CanDraft(domain.ID(p.UserID), input.ExpectedVersion); e != nil {
			return e
		}
		requests, e := tx.LabRequests(ctx, v.ID)
		if e != nil {
			return e
		}
		if !labsResolved(requests) {
			return domain.Fail("LAB_PENDING", "All LAB requests must be resolved before signing")
		}
		if v.State != "IN_PROGRESS" {
			return domain.Fail("STATE_CONFLICT", "Visit not ready for signing")
		}
		notes, e := tx.Notes(ctx, v.ID)
		if e != nil {
			return e
		}
		if len(notes) == 0 || strings.TrimSpace(notes[len(notes)-1].Diagnosis) == "" {
			return domain.Fail("VALIDATION_ERROR", "Diagnosis required before signing")
		}
		now := s.now().UTC()
		if !p.LeaseExpiresAt.After(now) {
			return domain.Fail("AUTHZ_LEASE_EXPIRED", "Signing lease expired while waiting for the visit")
		}
		v.State = "SIGNED"
		v.SignedAt = &now
		v.Version++
		if e = tx.UpdateVisit(ctx, v); e != nil {
			return e
		}
		message := s.event(v, "VisitSigned", "EVENT", map[string]any{"visitId": v.ID, "appointmentId": v.AppointmentID, "signedAt": now, "version": v.Version}, meta)
		if e = tx.AppendMessage(ctx, message, "umc.events.clinical.v1", "clinical.visit-signed.v1"); e != nil {
			return e
		}
		out = domain.DraftResult{VisitID: v.ID, State: v.State, Version: v.Version}
		return tx.SaveReplay(ctx, domain.ID(p.UserID), "CL-010", domain.ID(key), hash, out)
	})
	return
}

func labsResolved(requests []domain.LabRequest) bool {
	for _, r := range requests {
		if r.State != "PUBLISHED" && r.State != "CANCELLED" && r.State != "SUPERSEDED" {
			return false
		}
	}
	return true
}
