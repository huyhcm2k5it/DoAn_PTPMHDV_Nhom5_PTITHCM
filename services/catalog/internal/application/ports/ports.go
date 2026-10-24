package ports

import (
	"context"
	"time"
	"umccare/catalog/internal/domain"
)

type DoctorQuery struct {
	DepartmentID string
	Page         int
	Limit        int
}
type ServiceQuery struct {
	DepartmentID string
	At           time.Time
}
type SearchQuery struct {
	Q      string
	Status string
}
type Doctors struct {
	Items []domain.Doctor `json:"items"`
	Total int             `json:"total"`
}
type Meta struct {
	CorrelationID string
	RequestID     string
}
type Changed struct {
	MessageID     string
	CorrelationID string
	RequestID     string
	OccurredAt    time.Time
	Price         domain.Price
	Sequence      int64
}
type Reader interface {
	Departments(context.Context) ([]domain.Department, error)
	Doctors(context.Context, DoctorQuery) (Doctors, error)
	MedicalServices(context.Context, ServiceQuery) ([]domain.MedicalService, error)
	Medicines(context.Context, SearchQuery, time.Time) ([]domain.Medicine, error)
	LabTests(context.Context, SearchQuery, time.Time) ([]domain.LabTest, error)
	Access(context.Context, string) (domain.Access, error)
}
type PriceTx interface {
	Replay(context.Context, string, string) (domain.PriceResult, string, bool, error)
	LockItem(context.Context, string, string) (bool, error)
	Overlap(context.Context, domain.PriceInput) (bool, error)
	NextRevision(context.Context, string, string) (int, error)
	InsertPrice(context.Context, domain.Price) error
	SaveReplay(context.Context, string, string, string, domain.PriceResult) error
	NextSequence(context.Context) (int64, error)
	AppendChanged(context.Context, Changed) error
}
type PriceTransactions interface {
	Within(context.Context, string, string, func(PriceTx) error) error
}
type Clock interface{ Now() time.Time }
type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now().UTC() }

type Catalog interface {
	Departments(context.Context) ([]domain.Department, error)
	Doctors(context.Context, DoctorQuery) (Doctors, error)
	MedicalServices(context.Context, ServiceQuery) ([]domain.MedicalService, error)
	Medicines(context.Context, domain.Principal, SearchQuery) ([]domain.Medicine, error)
	LabTests(context.Context, domain.Principal, SearchQuery) ([]domain.LabTest, error)
	CreatePrice(context.Context, domain.Principal, string, domain.PriceInput, Meta) (domain.PriceResult, error)
}
