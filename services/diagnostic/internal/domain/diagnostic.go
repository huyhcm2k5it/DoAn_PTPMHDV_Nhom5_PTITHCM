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

type Principal struct {
	UserID, ActorType string
	TokenVersion      int
	Capabilities      []string
	LeaseAction       string
	LeaseExpiresAt    time.Time
}
type Access struct {
	UserID, ActorType, Status string
	TokenVersion              int
	Capabilities              []string
}

func Has(a []string, s string) bool {
	for _, x := range a {
		if x == s {
			return true
		}
	}
	return false
}

type TestSnapshot struct {
	TestID         string `json:"testId"`
	Revision       int    `json:"revision"`
	Code           string `json:"code"`
	Name           string `json:"name"`
	Unit           string `json:"unit"`
	ReferenceRange string `json:"referenceRange"`
}
type CreateInput struct {
	RequestID    string         `json:"requestId"`
	VisitID      string         `json:"visitId"`
	PatientID    string         `json:"patientId"`
	DoctorID     string         `json:"doctorId"`
	Tests        []TestSnapshot `json:"testSnapshot"`
	RequestHash  string         `json:"requestHash"`
	AuthorizedAt time.Time      `json:"authorizedAt"`
}

func (i CreateInput) Hash() string {
	return Hash(map[string]any{"requestId": i.RequestID, "visitId": i.VisitID, "patientId": i.PatientID, "doctorId": i.DoctorID, "testSnapshot": i.Tests, "authorizedAt": i.AuthorizedAt})
}
func (i CreateInput) Validate() error {
	if !ValidID(i.RequestID) || !ValidID(i.VisitID) || !ValidID(i.PatientID) || !ValidID(i.DoctorID) || i.AuthorizedAt.IsZero() || len(i.Tests) < 1 || len(i.Tests) > 100 || i.RequestHash != i.Hash() {
		return Fail("INVALID_MESSAGE", "Invalid laboratory request")
	}
	seen := map[string]bool{}
	for _, t := range i.Tests {
		if !ValidID(t.TestID) || t.Revision < 1 || t.Code == "" || t.Name == "" || seen[ID(t.TestID)] {
			return Fail("INVALID_MESSAGE", "Invalid test snapshot")
		}
		seen[ID(t.TestID)] = true
	}
	return nil
}

type Order struct {
	ID              string         `json:"id"`
	RequestID       string         `json:"requestId"`
	RequestHash     string         `json:"-"`
	VisitID         string         `json:"visitId"`
	PatientID       string         `json:"patientId"`
	DoctorID        string         `json:"doctorId"`
	State           string         `json:"state"`
	Version         int            `json:"version"`
	SourceRevision  int            `json:"sourceRevision"`
	ChargeID        string         `json:"chargeId,omitempty"`
	ChargeState     string         `json:"chargeState"`
	ChargeRequestID string         `json:"-"`
	AmountVND       int64          `json:"amountVnd"`
	AmountHash      string         `json:"snapshotHash"`
	Lines           []PriceLine    `json:"linesSnapshot"`
	Tests           []TestSnapshot `json:"tests"`
	Specimens       []Specimen     `json:"-"`
	SettlementID    string         `json:"-"`
	SettlementState string         `json:"-"`
	Fence           int            `json:"-"`
	AttemptVersion  int            `json:"-"`
	LastQueryAt     time.Time      `json:"-"`
	CreatedAt       time.Time      `json:"createdAt"`
}

func (o Order) MarshalJSON() ([]byte, error) {
	type alias Order
	lifecycle := map[string]string{"PENDING_PAYMENT": "WAITING_PAYMENT", "SETTLEMENT_LOCKED": "SETTLEMENT_LOCKED", "PAID": "PAID", "SPECIMEN_COLLECTED": "SAMPLING", "SPECIMEN_REJECTED": "RECOLLECT_REQUIRED", "CANCELLED": "CANCELLED", "PUBLISHED": "PUBLISHED"}[o.State]
	return json.Marshal(struct {
		alias
		LifecycleState string `json:"lifecycleState"`
	}{alias: alias(o), LifecycleState: lifecycle})
}

// Stored uses an explicit wire alias to retain private aggregate fields in storage.
type Stored struct {
	Order                                                       Order      `json:"order"`
	Specimens                                                   []Specimen `json:"specimens"`
	RequestHash, ChargeRequestID, SettlementID, SettlementState string
	Fence, AttemptVersion                                       int
	LastQueryAt                                                 time.Time
}

func (o Order) Stored() Stored {
	return Stored{o, o.Specimens, o.RequestHash, o.ChargeRequestID, o.SettlementID, o.SettlementState, o.Fence, o.AttemptVersion, o.LastQueryAt}
}
func (s Stored) Value() Order {
	o := s.Order
	o.Specimens = s.Specimens
	o.RequestHash = s.RequestHash
	o.ChargeRequestID = s.ChargeRequestID
	o.SettlementID = s.SettlementID
	o.SettlementState = s.SettlementState
	o.Fence = s.Fence
	o.AttemptVersion = s.AttemptVersion
	o.LastQueryAt = s.LastQueryAt
	return o
}

type PriceLine struct {
	ItemID         string `json:"itemId"`
	Code           string `json:"code"`
	Name           string `json:"name"`
	Quantity       int    `json:"quantity"`
	UnitPriceVND   int64  `json:"unitPriceVnd"`
	PriceVersionID string `json:"priceVersionId"`
	Revision       int    `json:"revision"`
}
type Specimen struct {
	ID          string    `json:"id"`
	OrderID     string    `json:"orderId"`
	State       string    `json:"state"`
	Sequence    int       `json:"sequence"`
	Barcode     string    `json:"barcode"`
	Version     int       `json:"version"`
	CollectedBy string    `json:"collectedBy"`
	CollectedAt time.Time `json:"collectedAt"`
	ReasonCode  string    `json:"reasonCode,omitempty"`
}

func (o Order) CanCollect(recollect bool) error {
	if o.State != "PAID" && o.State != "SPECIMEN_REJECTED" {
		return Fail("ORDER_NOT_PAID", "Order has no local payment evidence")
	}
	if o.ChargeState != "PAID" || o.Fence < 1 || o.SettlementState != "SUCCEEDED" {
		return Fail("ORDER_NOT_PAID", "Payment settlement is not synchronized")
	}
	if recollect {
		if len(o.Specimens) == 0 || o.Specimens[len(o.Specimens)-1].State != "REJECTED" {
			return Fail("STATE_CONFLICT", "Recollection requires rejected specimen")
		}
	} else if len(o.Specimens) > 0 {
		return Fail("SPECIMEN_ALREADY_COLLECTED", "Specimen already exists")
	}
	return nil
}
func (o *Order) Reserve(id, charge string, revision int, hash string, attempt int) error {
	if charge != o.ChargeID || revision != o.SourceRevision || hash != o.AmountHash || attempt < 1 {
		return Fail("SETTLEMENT_REJECTED", "Settlement source mismatch")
	}
	if o.SettlementID == id {
		if o.AttemptVersion != attempt {
			return Fail("SETTLEMENT_REJECTED", "Settlement attempt mismatch")
		}
		if o.SettlementState == "FAILED" {
			return Fail("SETTLEMENT_REJECTED", "Settlement already failed")
		}
		return nil
	}
	if o.State != "PENDING_PAYMENT" || o.ChargeState != "CREATED" || charge != o.ChargeID || revision != o.SourceRevision || hash != o.AmountHash || attempt < 1 {
		return Fail("SETTLEMENT_REJECTED", "Source is unavailable or snapshot changed")
	}
	o.Fence++
	o.SettlementID = id
	o.AttemptVersion = attempt
	o.SettlementState = "RESERVED"
	o.State = "SETTLEMENT_LOCKED"
	o.Version++
	return nil
}
func (o *Order) Decide(id string, fence int, state string) error {
	if o.SettlementID != id || o.Fence != fence {
		return Fail("STALE_FENCE", "Settlement fence mismatch")
	}
	if state == "UNKNOWN" {
		return nil
	}
	if o.SettlementState == "SUCCEEDED" || o.SettlementState == "FAILED" {
		if o.SettlementState == state {
			return nil
		}
		return Fail("STATE_CONFLICT", "Terminal settlement cannot reverse")
	}
	if state == "SUCCEEDED" {
		o.SettlementState = state
		o.ChargeState = "PAID"
		o.State = "PAID"
	} else if state == "FAILED" {
		o.SettlementState = state
		o.State = "PENDING_PAYMENT"
	} else {
		return Fail("INVALID_MESSAGE", "Invalid settlement decision")
	}
	o.Version++
	return nil
}

type Query struct {
	State       string
	Page, Limit int
}
type List struct {
	Items []Order `json:"items"`
	Total int     `json:"total"`
}
type Detail struct {
	Order     Order      `json:"order"`
	Specimens []Specimen `json:"specimens"`
	Results   []Result   `json:"results"`
}
type SampleInput struct {
	Barcode string `json:"barcode"`
}
type RejectInput struct {
	ReasonCode      string `json:"reasonCode"`
	ExpectedVersion int    `json:"expectedVersion"`
}
