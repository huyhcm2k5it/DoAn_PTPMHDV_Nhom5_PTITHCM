package domain

import (
	"crypto/rand"
	"errors"
	"fmt"
	"regexp"
	"time"
)

type Error struct {
	Kind    string
	Message string
}

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

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func ValidID(s string) bool { return uuidPattern.MatchString(s) }
func NewID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("secure random unavailable")
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

type Department struct {
	ID     string `json:"id"`
	Code   string `json:"code"`
	Name   string `json:"name"`
	Status string `json:"status"`
}
type Doctor struct {
	ID           string `json:"id"`
	DepartmentID string `json:"departmentId"`
	DisplayName  string `json:"displayName"`
	Status       string `json:"status"`
}
type MedicalService struct {
	ID           string `json:"id"`
	DepartmentID string `json:"departmentId"`
	Code         string `json:"code"`
	Name         string `json:"name"`
	Status       string `json:"status"`
	Price        *Price `json:"price"`
}
type Medicine struct {
	ID       string `json:"id"`
	Code     string `json:"code"`
	Name     string `json:"name"`
	Unit     string `json:"unit"`
	Strength string `json:"strength,omitempty"`
	Form     string `json:"form,omitempty"`
	Status   string `json:"status"`
	Price    *Price `json:"price"`
}
type LabTest struct {
	ID             string `json:"id"`
	Code           string `json:"code"`
	Name           string `json:"name"`
	SpecimenType   string `json:"specimenType"`
	Unit           string `json:"unit,omitempty"`
	ReferenceRange string `json:"referenceRange,omitempty"`
	Revision       int    `json:"revision"`
	Status         string `json:"status"`
	Price          *Price `json:"price"`
}
type PriceInput struct {
	ItemType      string     `json:"itemType"`
	ItemID        string     `json:"itemId"`
	AmountVND     int64      `json:"amountVnd"`
	EffectiveFrom time.Time  `json:"effectiveFrom"`
	EffectiveTo   *time.Time `json:"effectiveTo,omitempty"`
}
type Price struct {
	PriceVersionID string `json:"priceVersionId"`
	Revision       int    `json:"revision"`
	PriceInput
}
type PriceResult struct {
	PriceVersionID string    `json:"priceVersionId"`
	Revision       int       `json:"revision"`
	EffectiveFrom  time.Time `json:"effectiveFrom"`
}
type Access struct {
	UserID       string
	ActorType    string
	Capabilities []string
	TokenVersion int
	Status       string
}
type Principal struct {
	UserID       string
	ActorType    string
	Capabilities []string
	TokenVersion int
	LeaseAction  string
}

func Has(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
func (p PriceInput) Validate(now time.Time) error {
	if p.EffectiveFrom.Nanosecond()%1000 != 0 || (p.EffectiveTo != nil && p.EffectiveTo.Nanosecond()%1000 != 0) {
		return Fail("VALIDATION_ERROR", "Price timestamps support at most microsecond precision")
	}
	if !ValidID(p.ItemID) || !Has([]string{"EXAM", "LAB", "MEDICINE"}, p.ItemType) || p.AmountVND < 0 || p.EffectiveFrom.IsZero() {
		return Fail("VALIDATION_ERROR", "Invalid price fields")
	}
	if p.EffectiveFrom.Before(now.Add(5 * time.Minute)) {
		return Fail("VALIDATION_ERROR", "Price must become effective at least five minutes later")
	}
	if p.EffectiveTo != nil && !p.EffectiveTo.After(p.EffectiveFrom) {
		return Fail("VALIDATION_ERROR", "effectiveTo must be after effectiveFrom")
	}
	return nil
}
func Overlaps(a time.Time, b *time.Time, c time.Time, d *time.Time) bool {
	return (d == nil || a.Before(*d)) && (b == nil || c.Before(*b))
}
