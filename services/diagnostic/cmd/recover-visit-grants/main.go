// Operator-only recovery from the Clinical owner; never accepts user-supplied grants.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"umccare/diagnostic/internal/application/projection"
	"umccare/diagnostic/internal/domain"
)

type streamState struct {
	Last         int
	GapThrough   int
	LastHash     string
	CheckpointAt time.Time
}
type snapshot struct {
	Sequence    int
	GeneratedAt time.Time
	Last        projection.VisitGrantEvent
	Grants      []projection.VisitGrantEvent
}

func main() {
	apply := flag.Bool("apply", false, "replace only Diagnostic grant projections using the verified Clinical snapshot")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := run(ctx, *apply); err != nil {
		fmt.Fprintln(os.Stderr, "Grant recovery failed; no business data was modified:", safeError(err))
		os.Exit(1)
	}
}

// Do not print a connection error that may contain credentials.
func safeError(err error) string {
	var business *domain.Error
	if errors.As(err, &business) {
		return business.Message
	}
	return fmt.Sprintf("%T; verify connection, schema and operator logs", err)
}
func loadSnapshot(ctx context.Context, conn *pgx.Conn) (snapshot, error) {
	out := snapshot{}
	tx, err := conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	var database string
	if err = tx.QueryRow(ctx, "SELECT current_database()").Scan(&database); err != nil {
		return out, err
	}
	if database != "clinical_db" {
		return out, domain.Fail("VALIDATION_ERROR", "Source must be clinical_db")
	}
	if err = tx.QueryRow(ctx, "SELECT sequence FROM visit_grant_stream WHERE singleton").Scan(&out.Sequence); err != nil {
		return out, err
	}
	var raw []byte
	if err = tx.QueryRow(ctx, `SELECT envelope->'payload' FROM outbox WHERE routing_key='clinical.visit-doctor-grant-changed.v1'
 AND (envelope->'payload'->>'sequence')::bigint=$1
 ORDER BY CASE WHEN envelope->'payload'->>'mode'='UPSERT' THEN 0 ELSE 1 END,created_at,message_id LIMIT 1`, out.Sequence).Scan(&raw); err != nil {
		return out, err
	}
	if err = json.Unmarshal(raw, &out.Last); err != nil {
		return out, err
	}
	rows, err := tx.Query(ctx, `SELECT v.id::text,v.patient_id::text,v.doctor_user_id::text,g.active,v.state
 FROM visits v LEFT JOIN visit_doctor_grants g ON g.visit_id=v.id ORDER BY v.id`)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var grant projection.VisitGrantEvent
		var active *bool
		var state string
		if err = rows.Scan(&grant.VisitID, &grant.PatientID, &grant.DoctorUserID, &active, &state); err != nil {
			rows.Close()
			return out, err
		}
		if active == nil {
			rows.Close()
			return out, domain.Fail("SERVICE_UNAVAILABLE", "Clinical has a visit without an explicit grant; recovery must stop")
		}
		canCancel := *active && state != "SIGNED"
		grant.Mode = "UPSERT"
		grant.Sequence = out.Sequence
		grant.Active = active
		grant.CanCancel = &canCancel
		out.Grants = append(out.Grants, grant)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	out.GeneratedAt = time.Now().UTC()
	if err = validateSnapshot(out); err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}
func validateSnapshot(s snapshot) error {
	if s.Sequence < 1 || s.Last.Sequence != s.Sequence || len(s.Grants) > 10000 {
		return domain.Fail("VALIDATION_ERROR", "Invalid owner snapshot watermark or size")
	}
	if s.Last.Mode != "CHECKPOINT" && s.Last.Mode != "UPSERT" {
		return domain.Fail("VALIDATION_ERROR", "Invalid owner stream tail")
	}
	if s.Last.Mode == "UPSERT" && (s.Last.WatermarkOnly != nil || !domain.ValidID(s.Last.VisitID) || !domain.ValidID(s.Last.PatientID) || !domain.ValidID(s.Last.DoctorUserID) || s.Last.Active == nil || s.Last.CanCancel == nil || (!*s.Last.Active && *s.Last.CanCancel)) {
		return domain.Fail("VALIDATION_ERROR", "Invalid owner stream tail assignment")
	}
	if s.Last.Mode == "CHECKPOINT" && (s.Last.VisitID != "" || s.Last.PatientID != "" || s.Last.DoctorUserID != "" || s.Last.Active != nil || s.Last.CanCancel != nil || (s.Last.WatermarkOnly != nil && !*s.Last.WatermarkOnly)) {
		return domain.Fail("VALIDATION_ERROR", "Invalid owner checkpoint tail")
	}
	seen := map[string]bool{}
	for _, g := range s.Grants {
		if !domain.ValidID(g.VisitID) || !domain.ValidID(g.PatientID) || !domain.ValidID(g.DoctorUserID) || g.Sequence != s.Sequence || g.Mode != "UPSERT" || g.WatermarkOnly != nil || g.Active == nil || g.CanCancel == nil || (!*g.Active && *g.CanCancel) || seen[g.VisitID] {
			return domain.Fail("VALIDATION_ERROR", "Invalid or duplicate owner grant")
		}
		seen[g.VisitID] = true
	}
	return nil
}
func run(ctx context.Context, apply bool) error {
	sourceURL, targetURL := os.Getenv("CLINICAL_DATABASE_URL"), os.Getenv("DIAGNOSTIC_DATABASE_URL")
	if sourceURL == "" || targetURL == "" {
		return domain.Fail("VALIDATION_ERROR", "CLINICAL_DATABASE_URL and DIAGNOSTIC_DATABASE_URL are required")
	}
	source, err := pgx.Connect(ctx, sourceURL)
	if err != nil {
		return err
	}
	defer source.Close(ctx)
	s, err := loadSnapshot(ctx, source)
	if err != nil {
		return err
	}
	target, err := pgx.Connect(ctx, targetURL)
	if err != nil {
		return err
	}
	defer target.Close(ctx)
	opts := pgx.TxOptions{}
	if !apply {
		opts.AccessMode = pgx.ReadOnly
	}
	tx, err := target.BeginTx(ctx, opts)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var database string
	if err = tx.QueryRow(ctx, "SELECT current_database()").Scan(&database); err != nil {
		return err
	}
	if database != "diagnostic_db" {
		return domain.Fail("VALIDATION_ERROR", "Target must be diagnostic_db")
	}
	if apply {
		if _, err = tx.Exec(ctx, "SET LOCAL lock_timeout='5s'"); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('diagnostic:business',0))"); err != nil {
			return err
		}
	}
	var raw []byte
	var current streamState
	err = tx.QueryRow(ctx, "SELECT value FROM objects WHERE kind='visit_grant_stream' AND key='current'").Scan(&raw)
	if err == nil {
		if err = json.Unmarshal(raw, &current); err != nil {
			return err
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if current.Last > s.Sequence || current.GapThrough > s.Sequence {
		return domain.Fail("STATE_CONFLICT", "Diagnostic observed a newer sequence; export a fresh owner snapshot")
	}
	fmt.Printf("Owner snapshot: sequence=%d grants=%d; Diagnostic: last=%d gapThrough=%d; apply=%t\n", s.Sequence, len(s.Grants), current.Last, current.GapThrough, apply)
	if !apply {
		return tx.Commit(ctx)
	}
	if time.Since(s.GeneratedAt) > 25*time.Second {
		return domain.Fail("SERVICE_UNAVAILABLE", "Owner snapshot expired; retry recovery")
	}
	keys := make([]string, 0, len(s.Grants))
	for _, g := range s.Grants {
		keys = append(keys, g.VisitID)
	}
	if _, err = tx.Exec(ctx, "DELETE FROM objects WHERE kind='visit_grant' AND NOT(key=ANY($1::text[]))", keys); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "DELETE FROM objects WHERE kind='versions' AND key LIKE 'visit_grant:%' AND NOT(substring(key from 13)=ANY($1::text[]))", keys); err != nil {
		return err
	}
	payload, err := json.Marshal(s.Grants)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO objects(kind,key,value)
 SELECT 'visit_grant',g->>'visitId',g FROM jsonb_array_elements($1::jsonb) g
 ON CONFLICT(kind,key) DO UPDATE SET value=EXCLUDED.value`, payload); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO objects(kind,key,value)
 SELECT 'versions','visit_grant:'||(g->>'visitId'),jsonb_build_object('version',$2::integer,'value',g)
 FROM jsonb_array_elements($1::jsonb) g ON CONFLICT(kind,key) DO UPDATE SET value=EXCLUDED.value`, payload, s.Sequence); err != nil {
		return err
	}
	state := streamState{Last: s.Sequence, GapThrough: s.Sequence, LastHash: domain.Hash(s.Last), CheckpointAt: s.GeneratedAt}
	raw, err = json.Marshal(state)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO objects(kind,key,value) VALUES('visit_grant_stream','current',$1)
 ON CONFLICT(kind,key) DO UPDATE SET value=EXCLUDED.value`, raw); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	fmt.Println("Committed owner grant snapshot; business tables, inbox and DLQ unchanged.")
	return nil
}
