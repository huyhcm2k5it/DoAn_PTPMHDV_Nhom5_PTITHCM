package domain

import (
	"strings"
	"time"
)

type PrescriptionLine struct {
	MedicineCode string `json:"medicineCode"`
	NameSnapshot string `json:"nameSnapshot,omitempty"`
	DoseText     string `json:"doseText"`
	Quantity     int    `json:"quantity"`
	Instruction  string `json:"instruction,omitempty"`
}
type PrescriptionInput struct {
	Lines           []PrescriptionLine `json:"lines"`
	ExpectedVersion int                `json:"expectedVersion,omitempty"`
}

func (i PrescriptionInput) Validate(version bool) error {
	if i.Lines == nil || len(i.Lines) > 100 || (version && (i.ExpectedVersion < 1 || i.ExpectedVersion > 2147483647)) {
		return Fail("VALIDATION_ERROR", "Lines and positive expectedVersion required")
	}
	seen := map[string]bool{}
	for _, l := range i.Lines {
		if strings.TrimSpace(l.MedicineCode) == "" || len(l.MedicineCode) > 100 || len(l.NameSnapshot) > 300 || strings.TrimSpace(l.DoseText) == "" || len(l.DoseText) > 1000 || l.Quantity < 1 || l.Quantity > 2147483647 || len(l.Instruction) > 2000 || seen[l.MedicineCode] {
			return Fail("VALIDATION_ERROR", "Valid unique medicines, doses and positive quantities required")
		}
		seen[l.MedicineCode] = true
	}
	return nil
}

type Prescription struct {
	ID          string             `json:"id"`
	VisitID     string             `json:"visitId"`
	PatientID   string             `json:"patientId"`
	State       string             `json:"state"`
	Version     int                `json:"version"`
	Revision    int                `json:"revision"`
	Lines       []PrescriptionLine `json:"lines"`
	FinalizedAt *time.Time         `json:"finalizedAt,omitempty"`
}
type VersionInput struct {
	ExpectedVersion int `json:"expectedVersion"`
}

func (i VersionInput) Validate() error {
	if i.ExpectedVersion < 1 || i.ExpectedVersion > 2147483647 {
		return Fail("VALIDATION_ERROR", "Positive expectedVersion required")
	}
	return nil
}

type TestSelection struct {
	TestID   string `json:"testId"`
	Revision int    `json:"revision"`
}
type LabInput struct {
	Tests []TestSelection `json:"tests"`
}

func (i LabInput) Validate() error {
	if len(i.Tests) < 1 || len(i.Tests) > 100 {
		return Fail("VALIDATION_ERROR", "One to 100 tests required")
	}
	seen := map[string]bool{}
	for _, t := range i.Tests {
		if !ValidID(t.TestID) || t.Revision < 1 || t.Revision > 2147483647 || seen[ID(t.TestID)] {
			return Fail("VALIDATION_ERROR", "Unique test IDs and revisions required")
		}
		seen[ID(t.TestID)] = true
	}
	return nil
}

type TestSnapshot struct {
	TestID         string `json:"testId"`
	Revision       int    `json:"revision"`
	Code           string `json:"code"`
	Name           string `json:"name"`
	Unit           string `json:"unit"`
	ReferenceRange string `json:"referenceRange"`
}
type LabRequest struct {
	RequestID     string         `json:"requestId"`
	VisitID       string         `json:"visitId"`
	State         string         `json:"state"`
	OrderID       string         `json:"orderId,omitempty"`
	ReasonCode    string         `json:"reasonCode,omitempty"`
	RequestHash   string         `json:"-"`
	SourceVersion int            `json:"-"`
	Tests         []TestSnapshot `json:"tests"`
}
type LabTerminal struct {
	RequestID, VisitID, OrderID, State, Hash string
	Revision                                 int
	PublishedAt                              time.Time
}
type LabPending struct {
	RequestID string `json:"requestId"`
	State     string `json:"state"`
	StatusURL string `json:"statusUrl"`
}
type CreateLabOrder struct {
	RequestID    string         `json:"requestId"`
	VisitID      string         `json:"visitId"`
	PatientID    string         `json:"patientId"`
	DoctorID     string         `json:"doctorId"`
	TestSnapshot []TestSnapshot `json:"testSnapshot"`
	RequestHash  string         `json:"requestHash"`
	AuthorizedAt time.Time      `json:"authorizedAt"`
}

func (c CreateLabOrder) Hash() string {
	return Hash(map[string]any{"requestId": c.RequestID, "visitId": c.VisitID, "patientId": c.PatientID, "doctorId": c.DoctorID, "testSnapshot": c.TestSnapshot, "authorizedAt": c.AuthorizedAt})
}

type CatalogEntity struct {
	ID             string `json:"id"`
	Code           string `json:"code"`
	Name           string `json:"name"`
	Unit           string `json:"unit"`
	ReferenceRange string `json:"referenceRange"`
	Revision       int    `json:"revision"`
	Status         string `json:"status"`
}
