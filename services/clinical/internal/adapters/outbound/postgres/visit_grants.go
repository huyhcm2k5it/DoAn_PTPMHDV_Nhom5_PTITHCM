package postgres

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
	"umccare/clinical/migrations"
)

const grantMessage = "VisitDoctorGrantChanged"
const grantRoute = "clinical.visit-doctor-grant-changed.v1"
const grantStreamID = "00000000-0000-4000-8000-000000000013"

func migrateVisitGrants(ctx context.Context, tx pgx.Tx) error {
	const version = "000006_visit_grants"
	var applied bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version=$1)", version).Scan(&applied); err != nil || applied {
		return err
	}
	sql, err := migrations.Files.ReadFile(version + ".up.sql")
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, string(sql)); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "INSERT INTO schema_migrations(version) VALUES ($1)", version)
	return err
}

func (t clinicalTx) appendGrantEvent(ctx context.Context, aggregate string, body map[string]any, now time.Time, meta domain.Meta) error {
	var sequence int
	if err := t.tx.QueryRow(ctx, "UPDATE visit_grant_stream SET sequence=sequence+1 WHERE singleton RETURNING sequence").Scan(&sequence); err != nil {
		return err
	}
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
		var waiting bool
		if err := t.tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM outbox WHERE status='PENDING' AND routing_key=$1
			AND aggregate_id=$2)`, grantRoute, grantStreamID).Scan(&waiting); err != nil || waiting {
			return err
		}
		return t.appendGrantEvent(ctx, grantStreamID, map[string]any{"mode": "CHECKPOINT"}, now, domain.Meta{})
	})
}
