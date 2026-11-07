package usecase

import (
	"context"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

func (s *Service) Records(ctx context.Context, p domain.Principal, patientID string, page, limit int) (out domain.MedicalRecords, err error) {
	out.Items = []domain.MedicalRecord{}
	if !domain.ValidID(patientID) || page < 1 || page > 1000000 || limit < 1 || limit > 100 {
		return out, domain.Fail("VALIDATION_ERROR", "Invalid patient or pagination")
	}
	if p.LeaseAction != "CL-011" || !p.LeaseExpiresAt.After(s.now()) {
		return out, domain.Fail("AUTHZ_LEASE_EXPIRED", "Current CL-011 lease required")
	}
	err = s.store.Within(ctx, "", func(tx ports.ClinicalTx) error {
		if e := authorize(ctx, tx, p, "PATIENT", "DOCTOR"); e != nil {
			return e
		}
		access, e := tx.PatientAccess(ctx, domain.ID(patientID))
		if e != nil {
			return e
		}
		if !access.Active {
			return domain.Fail("NOT_FOUND", "Patient not found")
		}
		if p.ActorType == "DOCTOR" {
			return domain.Fail("SERVICE_UNAVAILABLE", "Current doctor-patient grant projection unavailable")
		}
		if access.OwnerUserID != domain.ID(p.UserID) {
			return domain.Fail("NOT_FOUND", "Patient not found")
		}
		reader, ok := tx.(ports.MedicalRecordsReader)
		if !ok {
			return domain.Fail("SERVICE_UNAVAILABLE", "Medical records reader unavailable")
		}
		out, e = reader.PatientRecords(ctx, domain.ID(patientID), page, limit)
		if e != nil {
			return e
		}
		if !p.LeaseExpiresAt.After(s.now()) {
			return domain.Fail("AUTHZ_LEASE_EXPIRED", "Read lease expired while waiting for records")
		}
		return nil
	})
	if err != nil {
		return domain.MedicalRecords{Items: []domain.MedicalRecord{}}, err
	}
	return
}
