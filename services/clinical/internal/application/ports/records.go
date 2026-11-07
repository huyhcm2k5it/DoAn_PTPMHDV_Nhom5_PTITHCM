package ports

import (
	"context"
	"umccare/clinical/internal/domain"
)

type MedicalRecordsReader interface {
	PatientRecords(context.Context, string, int, int) (domain.MedicalRecords, error)
}

type MedicalRecords interface {
	Records(context.Context, domain.Principal, string, int, int) (domain.MedicalRecords, error)
}
