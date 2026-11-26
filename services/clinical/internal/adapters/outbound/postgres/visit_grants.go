package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

const grantMessage = "VisitDoctorGrantChanged"
const grantRoute = "clinical.visit-doctor-grant-changed.v1"
const grantStreamID = "00000000-0000-4000-8000-000000000013"

// The caller locks the visit first, matching ReconcileVisitGrant's lock order.
// Signing preserves the grant. An explicit revocation ends assigned-doctor access.
func (t clinicalTx) CheckVisitGrant(ctx context.Context, visitID string) error {
	var active bool
	err := t.tx.QueryRow(ctx, "SELECT active FROM visit_doctor_grants WHERE visit_id=$1 FOR SHARE", visitID).Scan(&active)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Fail("SERVICE_UNAVAILABLE", "Current visit grant is missing")
	}
	if err != nil {
		return err
	}
	if !active {
		return domain.Fail("FORBIDDEN", "Visit access has been revoked")
	}
	return nil
}

func (t clinicalTx) appendGrantEvent(ctx context.Context, aggregate string, body map[string]any, now time.Time, meta domain.Meta) error {
	var sequence int
	if err := t.tx.QueryRow(ctx, "UPDATE visit_grant_stream SET sequence=sequence+1 WHERE singleton RETURNING sequence").Scan(&sequence); err != nil {
		return err
	}
	return t.appendGrantEnvelope(ctx, aggregate, body, now, meta, sequence)
}

func (t clinicalTx) appendGrantEnvelope(ctx context.Context, aggregate string, body map[string]any, now time.Time, meta domain.Meta, sequence int) error {
	body["sequence"] = sequence
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	messageID := domain.NewID()
	if meta.CorrelationID == "" {
		meta.CorrelationID = messageID
	}
	if !domain.ValidID(meta.RequestID) {
		meta.RequestID = messageID
	}
	m := domain.Envelope{
		MessageID: messageID, MessageKind: "EVENT", MessageType: grantMessage, SchemaVersion: 1,
		Producer: "clinical", AggregateID: aggregate, AggregateVersion: sequence,
		CorrelationID: meta.CorrelationID, CausationID: meta.RequestID, RequestID: meta.RequestID,
		OccurredAt: now.UTC(), Payload: payload,
	}
	return t.AppendMessage(ctx, m, "umc.events.clinical.v1", grantRoute)
}

// PublishVisitGrant derives authority from the locked Clinical visit. A refresh
// after signing preserves an explicit revocation.
func (t clinicalTx) PublishVisitGrant(ctx context.Context, v domain.Visit, now time.Time, meta domain.Meta) error {
	var active bool
	if err := t.tx.QueryRow(ctx, `INSERT INTO visit_doctor_grants(visit_id,active) VALUES ($1,true)
		ON CONFLICT(visit_id) DO UPDATE SET active=visit_doctor_grants.active RETURNING active`, v.ID).Scan(&active); err != nil {
		return err
	}
	return t.appendGrantEvent(ctx, v.ID, map[string]any{
		"mode": "UPSERT", "visitId": v.ID, "patientId": v.PatientID, "doctorUserId": v.DoctorUserID,
		"active": active, "canCancel": active && v.State != "SIGNED",
	}, now, meta)
}

// ReconcileVisitGrant republishes one owner-verified visit or records its revocation.
func (p *Probe) ReconcileVisitGrant(ctx context.Context, id string, revoke bool, now time.Time) error {
	return p.Within(ctx, "", func(raw ports.ClinicalTx) error {
		t := raw.(clinicalTx)
		v, err := t.Visit(ctx, id)
		if err != nil {
			return err
		}
		if revoke {
			if _, err = t.tx.Exec(ctx, `INSERT INTO visit_doctor_grants(visit_id,active) VALUES ($1,false)
				ON CONFLICT(visit_id) DO UPDATE SET active=false`, id); err != nil {
				return err
			}
		}
		return t.PublishVisitGrant(ctx, v, now, domain.Meta{})
	})
}

func (p *Probe) PublishGrantCheckpoint(ctx context.Context, now time.Time) error {
	return p.Within(ctx, "visit-grant-checkpoint", func(raw ports.ClinicalTx) error {
		t := raw.(clinicalTx)
		// A heartbeat advertises the committed watermark. Only a grant change
		// consumes a sequence, so losing a heartbeat cannot create a data gap.
		var sequence int
		if err := t.tx.QueryRow(ctx, "SELECT sequence FROM visit_grant_stream WHERE singleton FOR UPDATE").Scan(&sequence); err != nil {
			return err
		}
		if sequence == 0 {
			return nil
		}
		var waiting bool
		if err := t.tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM outbox WHERE status='PENDING' AND routing_key=$1
			AND aggregate_id=$2)`, grantRoute, grantStreamID).Scan(&waiting); err != nil || waiting {
			return err
		}
		return t.appendGrantEnvelope(ctx, grantStreamID, map[string]any{"mode": "CHECKPOINT", "watermarkOnly": true}, now, domain.Meta{}, sequence)
	})
}
