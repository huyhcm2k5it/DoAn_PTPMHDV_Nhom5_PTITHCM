package ports

import (
	"context"
	"encoding/json"
	"time"
	"umccare/clinical/internal/domain"
)

type ClinicalTx interface {
	Access(context.Context, string) (domain.Access, error)
	PatientAccess(context.Context, string) (domain.PatientAccess, error)
	Ticket(context.Context, string) (domain.Ticket, error)
	Replay(context.Context, string, string, string) (json.RawMessage, string, bool, error)
	SaveReplay(context.Context, string, string, string, string, any) error
	CreateStart(context.Context, domain.StartRequest) error
	StartRequest(context.Context, string) (domain.StartRequest, error)
	UpdateStart(context.Context, domain.StartRequest) error
	AppendCommand(context.Context, domain.Envelope) error
	Visit(context.Context, string) (domain.Visit, error)
	VisitByAppointment(context.Context, string) (domain.Visit, bool, error)
	InsertVisit(context.Context, domain.Visit) error
	UpdateVisit(context.Context, domain.Visit) error
	AppendNote(context.Context, domain.VisitNote) error
	Notes(context.Context, string) ([]domain.VisitNote, error)
	Worklist(context.Context, string, domain.WorklistQuery) (domain.Worklist, error)
	SeenMessage(context.Context, string, string, string) (bool, error)
	MarkMessage(context.Context, string, string) error
	UpdateAccess(context.Context, domain.Access, int) error
	UpdatePatientAccess(context.Context, domain.PatientAccess) error
}
type ClinicalStore interface {
	Within(context.Context, string, func(ClinicalTx) error) error
}
type Incoming struct {
	MessageID, Exchange, RoutingKey string
	Body                            []byte
	Attempt                         int
	LeaseID                         string
}
type DeliveryStore interface {
	ScheduleRetry(context.Context, Incoming, int, time.Duration) error
	Quarantine(context.Context, Incoming, string) error
}
type Outgoing struct {
	MessageID, Exchange, RoutingKey string
	Body                            []byte
}
type Clinical interface {
	Worklist(context.Context, domain.Principal, domain.WorklistQuery) (domain.Worklist, error)
	Start(context.Context, domain.Principal, string, domain.StartInput, domain.Meta) (domain.StartResult, error)
	Detail(context.Context, domain.Principal, string) (domain.VisitDetail, error)
	SaveDraft(context.Context, domain.Principal, string, string, domain.DraftInput) (domain.DraftResult, error)
}
