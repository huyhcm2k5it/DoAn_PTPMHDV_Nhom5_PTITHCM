package projection

import (
	"context"
	"encoding/json"
	"time"

	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

const VisitGrantStreamID = "00000000-0000-4000-8000-000000000013"

type VisitGrantEvent struct {
	Mode         string `json:"mode"`
	Sequence     int    `json:"sequence"`
	VisitID      string `json:"visitId,omitempty"`
	PatientID    string `json:"patientId,omitempty"`
	DoctorUserID string `json:"doctorUserId,omitempty"`
	Active       *bool  `json:"active,omitempty"`
	CanCancel    *bool  `json:"canCancel,omitempty"`
}

type visitStream struct {
	Last         int
	GapThrough   int
	LastHash     string
	CheckpointAt time.Time
}

func readVisitStream(ctx context.Context, t ports.Tx) (state visitStream, err error) {
	raw, err := t.Get(ctx, "visit_grant_stream", "current")
	if domain.Code(err) == "NOT_FOUND" {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	if json.Unmarshal(raw, &state) != nil {
		return state, domain.Fail("SERVICE_UNAVAILABLE", "Invalid visit grant stream state")
	}
	return state, nil
}

// ApplyVisitGrant returns gap=true only after recording a durable gap marker.
// The caller commits the marker and schedules the original delivery for retry.
func ApplyVisitGrant(ctx context.Context, t ports.Tx, m domain.Envelope, p VisitGrantEvent, now time.Time) (gap bool, err error) {
	if p.Sequence < 1 || p.Sequence != m.AggregateVersion || m.OccurredAt.After(now.Add(5*time.Second)) {
		return false, domain.Fail("INVALID_MESSAGE", "Invalid visit grant sequence or timestamp")
	}
	switch p.Mode {
	case "CHECKPOINT":
		if domain.ID(m.AggregateID) != VisitGrantStreamID || p.VisitID != "" || p.PatientID != "" || p.DoctorUserID != "" || p.Active != nil || p.CanCancel != nil {
			return false, domain.Fail("INVALID_MESSAGE", "Invalid visit grant checkpoint")
		}
	case "UPSERT":
		if !domain.ValidID(p.VisitID) || !domain.ValidID(p.PatientID) || !domain.ValidID(p.DoctorUserID) || domain.ID(p.VisitID) != domain.ID(m.AggregateID) || p.Active == nil || p.CanCancel == nil || (!*p.Active && *p.CanCancel) {
			return false, domain.Fail("INVALID_MESSAGE", "Invalid visit grant assignment")
		}
		p.VisitID, p.PatientID, p.DoctorUserID = domain.ID(p.VisitID), domain.ID(p.PatientID), domain.ID(p.DoctorUserID)
	default:
		return false, domain.Fail("INVALID_MESSAGE", "Unknown visit grant event mode")
	}

	state, err := readVisitStream(ctx, t)
	if err != nil {
		return false, err
	}
	hash := domain.Hash(p)
	if p.Sequence <= state.Last {
		if p.Sequence == state.Last && state.LastHash != hash {
			return false, domain.Fail("INVALID_MESSAGE", "Conflicting visit grant sequence")
		}
		return false, nil
	}
	if p.Sequence > state.Last+1 {
		state.GapThrough = max(state.GapThrough, p.Sequence)
		return true, t.Put(ctx, "visit_grant_stream", "current", state)
	}
	if p.Mode == "CHECKPOINT" {
		state.CheckpointAt = m.OccurredAt
	} else if err = Put(ctx, t, "visit_grant", p.VisitID, p.Sequence, p); err != nil {
		return false, err
	}
	state.Last, state.LastHash = p.Sequence, hash
	return false, t.Put(ctx, "visit_grant_stream", "current", state)
}

func RequireCurrentVisitStream(ctx context.Context, t ports.Tx, now time.Time) error {
	s, err := readVisitStream(ctx, t)
	if err != nil {
		return err
	}
	if s.Last < s.GapThrough || s.CheckpointAt.IsZero() || now.Sub(s.CheckpointAt) >= 30*time.Second || s.CheckpointAt.After(now.Add(5*time.Second)) {
		return domain.Fail("SERVICE_UNAVAILABLE", "Current doctor-visit grant projection unavailable")
	}
	return nil
}
