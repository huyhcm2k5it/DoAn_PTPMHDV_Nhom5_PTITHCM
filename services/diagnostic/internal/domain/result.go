package domain

import "time"

type ResultItemInput struct {
	TestCode       string `json:"testCode"`
	ValueText      string `json:"valueText"`
	Unit           string `json:"unit,omitempty"`
	ReferenceRange string `json:"referenceRange,omitempty"`
	Flag           string `json:"flag,omitempty"`
}
type ResultItem struct {
	ID string `json:"id"`
	ResultItemInput
}
type Result struct {
	ID          string       `json:"id"`
	OrderID     string       `json:"orderId"`
	SpecimenID  string       `json:"specimenId"`
	Revision    int          `json:"revision"`
	State       string       `json:"state"`
	EnteredBy   string       `json:"enteredBy"`
	SubmittedAt *time.Time   `json:"submittedAt,omitempty"`
	PublishedAt *time.Time   `json:"publishedAt,omitempty"`
	Version     int          `json:"version"`
	Items       []ResultItem `json:"items"`
}
type ResultCreateInput struct {
	Items []ResultItemInput `json:"items"`
}
type ResultUpdateInput struct {
	Items           []ResultItemInput `json:"items"`
	ExpectedVersion int               `json:"expectedVersion"`
}
type ResultReviewInput struct {
	ExpectedVersion int `json:"expectedVersion"`
}
type ResultReworkInput struct {
	Reason          string `json:"reason"`
	ExpectedVersion int    `json:"expectedVersion"`
}
type ResultMeta struct{ CorrelationID string }

type CancelInput struct {
	ReasonCode      string `json:"reasonCode"`
	ExpectedVersion int    `json:"expectedVersion"`
}
type CancelData struct {
	Order        Order  `json:"order"`
	RefundStatus string `json:"refundStatus"`
}

type PublishedResults struct {
	Items []Result `json:"items"`
	Total int      `json:"total"`
}
