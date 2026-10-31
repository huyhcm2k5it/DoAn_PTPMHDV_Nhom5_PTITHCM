package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type Error struct{ Kind, Message string }

func (e *Error) Error() string        { return e.Message }
func Fail(code, message string) error { return &Error{code, message} }
func Code(err error) string {
	if err == nil {
		return ""
	}
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	return "SERVICE_UNAVAILABLE"
}

var idPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func ValidID(id string) bool { return idPattern.MatchString(id) }
func ID(id string) string    { return strings.ToLower(id) }
func NewID() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic("secure random unavailable")
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func Hash(value any) string {
	b, _ := json.Marshal(value)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

type Principal struct {
	UserID, ActorType string
	TokenVersion      int
}
type Access struct {
	UserID, ActorType, Status string
	TokenVersion              int
}
type PatientAccess struct {
	PatientID, OwnerUserID string
	Active                 bool
	PolicyVersion          int
}
type Ticket struct {
	ID            string `json:"ticketId"`
	AppointmentID string `json:"appointmentId"`
	PatientID     string `json:"patientId"`
	DoctorID      string `json:"doctorId"`
	DoctorUserID  string `json:"doctorUserId"`
	DepartmentID  string `json:"departmentId"`
	VisitID       string `json:"visitId,omitempty"`
	TicketType    string `json:"ticketType"`
	State         string `json:"state"`
	Version       int    `json:"version"`
}
type StartInput struct {
	TicketID              string `json:"ticketId"`
	DoctorID              string `json:"doctorId"`
	ExpectedTicketVersion int    `json:"expectedTicketVersion"`
}

func (i *StartInput) Validate() error {
	if !ValidID(i.TicketID) || !ValidID(i.DoctorID) || i.ExpectedTicketVersion < 1 || i.ExpectedTicketVersion > 2147483647 {
		return Fail("VALIDATION_ERROR", "Valid ticket, doctor and positive version required")
	}
	i.TicketID = ID(i.TicketID)
	i.DoctorID = ID(i.DoctorID)
	return nil
}

type StartResult struct {
	RequestID   string `json:"requestId"`
	OperationID string `json:"operationId"`
	State       string `json:"state"`
	StatusURL   string `json:"statusUrl"`
}
type StartRequest struct {
	StartResult
	DoctorUserID string    `json:"-"`
	Ticket       Ticket    `json:"-"`
	VisitID      string    `json:"visitId,omitempty"`
	ReasonCode   string    `json:"reasonCode,omitempty"`
	ClaimID      string    `json:"-"`
	ClaimHash    string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}
type Visit struct {
	ID            string     `json:"id"`
	AppointmentID string     `json:"appointmentId"`
	PatientID     string     `json:"patientId"`
	DoctorUserID  string     `json:"doctorUserId"`
	DepartmentID  string     `json:"departmentId"`
	ClaimID       string     `json:"claimId"`
	State         string     `json:"state"`
	Version       int        `json:"version"`
	ReturnRound   int        `json:"returnRound"`
	StartedAt     time.Time  `json:"startedAt"`
	SignedAt      *time.Time `json:"signedAt,omitempty"`
}

var visitStates = map[string]bool{"IN_PROGRESS": true, "LAB_REQUEST_PENDING": true, "WAITING_LAB": true, "RETURN_READY": true, "WAITING_RETURN": true, "SIGNED": true}

func ValidState(s string) bool { return s == "" || visitStates[s] }
func (v Visit) CanDraft(actor string, version int) error {
	if ID(v.DoctorUserID) != ID(actor) {
		return Fail("FORBIDDEN", "Visit belongs to another doctor")
	}
	if v.State == "SIGNED" {
		return Fail("VISIT_ALREADY_SIGNED", "Signed visits are immutable")
	}
	if v.Version != version {
		return Fail("VISIT_VERSION_CONFLICT", "Visit changed; reload before saving")
	}
	return nil
}

type DraftInput struct {
	Symptoms        *string `json:"symptoms"`
	Findings        *string `json:"findings"`
	Assessment      *string `json:"assessment"`
	Diagnosis       *string `json:"diagnosis"`
	ExpectedVersion int     `json:"expectedVersion"`
}

func (i DraftInput) Validate() error {
	if i.ExpectedVersion < 1 || i.ExpectedVersion > 2147483647 {
		return Fail("VALIDATION_ERROR", "Positive expectedVersion required")
	}
	for _, f := range []*string{i.Symptoms, i.Findings, i.Assessment, i.Diagnosis} {
		if f == nil || utf8.RuneCountInString(*f) > 10000 {
			return Fail("VALIDATION_ERROR", "All four draft fields required, at most 10000 characters each")
		}
	}
	return nil
}

type VisitNote struct {
	ID           string    `json:"id"`
	VisitID      string    `json:"visitId"`
	Revision     int       `json:"revision"`
	Symptoms     string    `json:"symptoms"`
	Findings     string    `json:"findings"`
	Assessment   string    `json:"assessment"`
	Diagnosis    string    `json:"diagnosis"`
	AuthorUserID string    `json:"authorUserId"`
	SavedAt      time.Time `json:"savedAt"`
}
type DraftResult struct {
	VisitID string `json:"visitId"`
	Version int    `json:"version"`
	State   string `json:"state"`
}
type VisitDetail struct {
	Visit         Visit       `json:"visit"`
	Notes         []VisitNote `json:"notes"`
	Prescriptions []any       `json:"prescriptions"`
	LabRequests   []any       `json:"labRequests"`
}
type WorklistQuery struct {
	Date, State, OperationID string
	Page, Limit              int
}

func (q *WorklistQuery) Validate() error {
	if q.Page == 0 {
		q.Page = 1
	}
	if q.Limit == 0 {
		q.Limit = 20
	}
	if q.Page < 1 || q.Page > 1000000 || q.Limit < 1 || q.Limit > 100 || !ValidState(q.State) || (q.OperationID != "" && !ValidID(q.OperationID)) {
		return Fail("VALIDATION_ERROR", "Invalid filter or pagination")
	}
	if q.Date != "" {
		if _, e := time.Parse("2006-01-02", q.Date); e != nil {
			return Fail("VALIDATION_ERROR", "Invalid UTC date")
		}
	}
	q.OperationID = ID(q.OperationID)
	return nil
}

type Worklist struct {
	Items        []Visit       `json:"items"`
	Total        int           `json:"total"`
	StartRequest *StartRequest `json:"startRequest"`
}
type Meta struct{ CorrelationID, RequestID string }
type Envelope struct {
	MessageID        string          `json:"messageId"`
	MessageKind      string          `json:"messageKind"`
	MessageType      string          `json:"messageType"`
	SchemaVersion    int             `json:"schemaVersion"`
	Producer         string          `json:"producer"`
	AggregateID      string          `json:"aggregateId"`
	AggregateVersion int             `json:"aggregateVersion"`
	CorrelationID    string          `json:"correlationId"`
	CausationID      string          `json:"causationId"`
	RequestID        string          `json:"requestId"`
	OccurredAt       time.Time       `json:"occurredAt"`
	Payload          json.RawMessage `json:"payload"`
}
type ClaimCommand struct {
	RequestID             string `json:"requestId"`
	TicketID              string `json:"ticketId"`
	ExpectedTicketVersion int    `json:"expectedTicketVersion"`
	DoctorID              string `json:"doctorId"`
	PatientID             string `json:"patientId"`
}
type ClaimResult struct {
	RequestID     string `json:"requestId"`
	TicketID      string `json:"ticketId"`
	AppointmentID string `json:"appointmentId"`
	PatientID     string `json:"patientId"`
	VisitID       string `json:"visitId,omitempty"`
	ClaimID       string `json:"claimId,omitempty"`
	State         string `json:"state"`
	ReasonCode    string `json:"reasonCode,omitempty"`
}

func (e Envelope) ValidateClaim(exchange string, p ClaimResult) error {
	if exchange != "umc.events.appointment.v1" || e.Producer != "appointment" || e.MessageKind != "EVENT" || e.MessageType != "QueueTicketClaimed" || e.SchemaVersion != 1 || !ValidID(e.MessageID) || !ValidID(e.AggregateID) || e.AggregateVersion < 1 || e.CorrelationID == "" || len(e.CorrelationID) > 128 || !ValidID(e.CausationID) || !ValidID(e.RequestID) || e.OccurredAt.IsZero() {
		return Fail("INVALID_MESSAGE", "Untrusted or invalid claim envelope")
	}
	for _, v := range []string{p.RequestID, p.TicketID, p.AppointmentID, p.PatientID} {
		if !ValidID(v) {
			return Fail("INVALID_MESSAGE", "Invalid claim identity")
		}
	}
	if ID(e.RequestID) != ID(p.RequestID) || ID(e.AggregateID) != ID(p.TicketID) || (p.VisitID != "" && !ValidID(p.VisitID)) || (p.ClaimID != "" && !ValidID(p.ClaimID)) {
		return Fail("INVALID_MESSAGE", "Claim correlation mismatch")
	}
	if p.State != "ACCEPTED" && p.State != "REJECTED" {
		return Fail("INVALID_MESSAGE", "Unknown claim state")
	}
	if p.State == "ACCEPTED" && !ValidID(p.ClaimID) {
		return Fail("INVALID_MESSAGE", "Accepted claim requires claimId")
	}
	if len(p.ReasonCode) > 100 || (p.State == "REJECTED" && p.ReasonCode == "") {
		return Fail("INVALID_MESSAGE", "Rejected claim requires bounded reasonCode")
	}
	return nil
}
