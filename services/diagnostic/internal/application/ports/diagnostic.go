package ports

import (
	"context"
	"encoding/json"
	"time"
	"umccare/diagnostic/internal/domain"
)

type Tx interface {
	Get(context.Context, string, string) (json.RawMessage, error)
	Put(context.Context, string, string, any) error
	Orders(context.Context) ([]domain.Order, error)
	SaveOrder(context.Context, domain.Order) error
	Outbox(context.Context, domain.Envelope, string, string) error
	SeenMessage(context.Context, string, string, string) (bool, error)
	MarkMessage(context.Context, string, string) error
}
type Store interface {
	Within(context.Context, string, func(Tx) error) error
}
type Incoming struct {
	MessageID, Exchange, RoutingKey string
	Body                            []byte
	Attempt                         int
	LeaseID                         string
}
type Outgoing struct {
	MessageID, Exchange, RoutingKey string
	Body                            []byte
}
type DeliveryStore interface {
	ScheduleRetry(context.Context, Incoming, int, time.Duration) error
	Quarantine(context.Context, Incoming, string) error
}

type Diagnostic interface {
	List(context.Context, domain.Principal, domain.Query) (domain.List, error)
	Detail(context.Context, domain.Principal, string) (domain.Detail, error)
	Sample(context.Context, domain.Principal, string, string, domain.SampleInput, bool) (domain.Specimen, error)
	Reject(context.Context, domain.Principal, string, string, domain.RejectInput) (domain.Specimen, error)
}

type Results interface {
	CreateResult(context.Context, domain.Principal, string, string, domain.ResultCreateInput) (domain.Result, error)
	UpdateResult(context.Context, domain.Principal, string, string, domain.ResultUpdateInput) (domain.Result, error)
	TransitionResult(context.Context, domain.Principal, string, string, string, int, string, domain.ResultMeta) (domain.Result, error)
}

// VisitGrantVerifier is implemented only by a trusted, current owner projection.
// Absence is a fail-closed integration boundary.
type VisitGrantVerifier interface {
	VerifyVisitGrant(context.Context, string, string) error
}
type Cancellation interface {
	CancelOrder(context.Context, domain.Principal, string, string, domain.CancelInput, domain.ResultMeta) (domain.CancelData, error)
}

type PublishedResultsReader interface {
	PublishedResults(context.Context, domain.Principal, string, int, int) (domain.PublishedResults, error)
}

type PublishedResultsRecords interface {
	PublishedResultsForPatient(context.Context, string, int, int) (domain.PublishedResults, error)
}
