package domain

import "time"

type PublishedLabResultReference struct {
	OrderID     string    `json:"orderId"`
	Revision    int       `json:"revision"`
	PublishedAt time.Time `json:"publishedAt"`
}

type MedicalRecord struct {
	Visit               Visit                         `json:"visit"`
	Note                VisitNote                     `json:"note"`
	Prescriptions       []Prescription                `json:"prescriptions"`
	PublishedLabResults []PublishedLabResultReference `json:"publishedLabResults"`
}

type MedicalRecords struct {
	Items []MedicalRecord `json:"items"`
	Total int             `json:"total"`
}
