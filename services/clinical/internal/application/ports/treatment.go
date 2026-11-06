package ports

import (
	"context"
	"umccare/clinical/internal/domain"
)

type TreatmentTx interface {
	ClinicalTx
	Prescription(context.Context, string) (domain.Prescription, error)
	Prescriptions(context.Context, string) ([]domain.Prescription, error)
	SavePrescription(context.Context, domain.Prescription) error
	Medicine(context.Context, string) (domain.CatalogEntity, error)
	LabTest(context.Context, string) (domain.CatalogEntity, error)
	PutCatalog(context.Context, string, domain.CatalogEntity) error
	LabRequests(context.Context, string) ([]domain.LabRequest, error)
	SaveLabRequest(context.Context, domain.LabRequest) error
	LabRequest(context.Context, string) (domain.LabRequest, error)
	LabTerminal(context.Context, string) (domain.LabTerminal, bool, error)
	SaveLabTerminal(context.Context, domain.LabTerminal) error
	DoctorID(context.Context, string) (string, error)
	AppendMessage(context.Context, domain.Envelope, string, string) error
}
type Treatment interface {
	RequestLab(context.Context, domain.Principal, string, string, domain.LabInput, domain.Meta) (domain.LabPending, error)
	CreatePrescription(context.Context, domain.Principal, string, string, domain.PrescriptionInput) (domain.Prescription, error)
	UpdatePrescription(context.Context, domain.Principal, string, string, domain.PrescriptionInput) (domain.Prescription, error)
	DeletePrescription(context.Context, domain.Principal, string, string, domain.VersionInput) (map[string]string, error)
	FinalizePrescription(context.Context, domain.Principal, string, string, domain.VersionInput, domain.Meta) (domain.Prescription, error)
	Complete(context.Context, domain.Principal, string, string, domain.VersionInput, domain.Meta) (domain.DraftResult, error)
}
