package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
	"umccare/clinical/migrations"
)

func (p *Probe) Migrate(ctx context.Context) error {
	tx, e := p.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('clinical:migrate',0)); CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`); e != nil {
		return e
	}
	var exists bool
	if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version='000001_clinical')`).Scan(&exists); e != nil {
		return e
	}
	if !exists {
		b, err := migrations.Files.ReadFile("000001_clinical.up.sql")
		if err != nil {
			return err
		}
		if _, e = tx.Exec(ctx, string(b)); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `INSERT INTO schema_migrations(version)VALUES('000001_clinical')`); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
func (p *Probe) BusinessReady(ctx context.Context) error {
	var ok bool
	if e := p.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version='000001_clinical')`).Scan(&ok); e != nil || !ok {
		return domain.Fail("SERVICE_UNAVAILABLE", "Clinical migrations are required")
	}
	return nil
}

type clinicalTx struct{ tx pgx.Tx }

func (p *Probe) Within(ctx context.Context, lock string, fn func(ports.ClinicalTx) error) error {
	tx, e := p.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if lock != "" {
		if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, lock); e != nil {
			return e
		}
	}
	if e = fn(clinicalTx{tx}); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (t clinicalTx) Access(ctx context.Context, id string) (a domain.Access, e error) {
	e = t.tx.QueryRow(ctx, `SELECT user_id::text,actor_type,status,token_version FROM user_access_projection WHERE user_id=$1 FOR SHARE`, id).Scan(&a.UserID, &a.ActorType, &a.Status, &a.TokenVersion)
	if errors.Is(e, pgx.ErrNoRows) {
		e = domain.Fail("SERVICE_UNAVAILABLE", "User access projection is missing")
	}
	return
}
func (t clinicalTx) PatientAccess(ctx context.Context, id string) (a domain.PatientAccess, e error) {
	e = t.tx.QueryRow(ctx, `SELECT patient_id::text,owner_user_id::text,active,policy_version FROM patient_access_projection WHERE patient_id=$1 FOR SHARE`, id).Scan(&a.PatientID, &a.OwnerUserID, &a.Active, &a.PolicyVersion)
	if errors.Is(e, pgx.ErrNoRows) {
		e = domain.Fail("SERVICE_UNAVAILABLE", "Patient access projection is missing")
	}
	return
}
func (t clinicalTx) Ticket(ctx context.Context, id string) (v domain.Ticket, e error) {
	e = t.tx.QueryRow(ctx, `SELECT ticket_id::text,appointment_id::text,patient_id::text,doctor_id::text,doctor_user_id::text,department_id::text,ticket_type,state,version,COALESCE(visit_id::text,'') FROM ticket_projection WHERE ticket_id=$1 FOR SHARE`, id).Scan(&v.ID, &v.AppointmentID, &v.PatientID, &v.DoctorID, &v.DoctorUserID, &v.DepartmentID, &v.TicketType, &v.State, &v.Version, &v.VisitID)
	if errors.Is(e, pgx.ErrNoRows) {
		e = domain.Fail("SERVICE_UNAVAILABLE", "Trusted ticket projection is unavailable")
	}
	return
}
func (t clinicalTx) Replay(ctx context.Context, actor, operation, key string) (raw json.RawMessage, hash string, found bool, e error) {
	if _, e = t.tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, actor+":"+operation+":"+key); e != nil {
		return
	}
	e = t.tx.QueryRow(ctx, `SELECT response,request_hash FROM idempotency_records WHERE actor_id=$1 AND operation=$2 AND idempotency_key=$3`, actor, operation, key).Scan(&raw, &hash)
	if errors.Is(e, pgx.ErrNoRows) {
		e = nil
		return
	}
	found = e == nil
	return
}
func (t clinicalTx) SaveReplay(ctx context.Context, actor, operation, key, hash string, response any) error {
	raw, e := json.Marshal(response)
	if e != nil {
		return e
	}
	_, e = t.tx.Exec(ctx, `INSERT INTO idempotency_records(actor_id,operation,idempotency_key,request_hash,response)VALUES($1,$2,$3,$4,$5)`, actor, operation, key, hash, raw)
	return e
}
func (t clinicalTx) CreateStart(ctx context.Context, r domain.StartRequest) error {
	ticket, e := json.Marshal(r.Ticket)
	if e != nil {
		return e
	}
	_, e = t.tx.Exec(ctx, `INSERT INTO start_requests(request_id,ticket_id,doctor_user_id,ticket_snapshot,state,created_at)VALUES($1,$2,$3,$4,$5,$6)`, r.RequestID, r.Ticket.ID, r.DoctorUserID, ticket, r.State, r.CreatedAt)
	return e
}
func (t clinicalTx) StartRequest(ctx context.Context, id string) (r domain.StartRequest, e error) {
	var raw []byte
	e = t.tx.QueryRow(ctx, `SELECT request_id::text,doctor_user_id::text,ticket_snapshot,state,COALESCE(visit_id::text,''),COALESCE(claim_id::text,''),claim_hash,reason_code,created_at FROM start_requests WHERE request_id=$1 FOR UPDATE`, id).Scan(&r.RequestID, &r.DoctorUserID, &raw, &r.State, &r.VisitID, &r.ClaimID, &r.ClaimHash, &r.ReasonCode, &r.CreatedAt)
	if errors.Is(e, pgx.ErrNoRows) {
		return r, domain.Fail("NOT_FOUND", "Start request not found")
	}
	if e != nil {
		return
	}
	e = json.Unmarshal(raw, &r.Ticket)
	r.OperationID = r.RequestID
	r.StatusURL = "/api/v1/clinical/worklist?operationId=" + r.RequestID
	return
}
func (t clinicalTx) UpdateStart(ctx context.Context, r domain.StartRequest) error {
	_, e := t.tx.Exec(ctx, `UPDATE start_requests SET state=$2,visit_id=NULLIF($3,'')::uuid,claim_id=NULLIF($4,'')::uuid,claim_hash=$5,reason_code=$6 WHERE request_id=$1`, r.RequestID, r.State, r.VisitID, r.ClaimID, r.ClaimHash, r.ReasonCode)
	return e
}
func (t clinicalTx) AppendCommand(ctx context.Context, m domain.Envelope) error {
	raw, e := json.Marshal(m)
	if e != nil {
		return e
	}
	_, e = t.tx.Exec(ctx, `INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope)VALUES($1,$2,'umc.commands.clinical.v1','appointment.claim-queue-ticket.v1',$3)`, m.MessageID, m.AggregateID, raw)
	return e
}

const visitColumns = `id::text,appointment_id::text,patient_id::text,doctor_user_id::text,department_id::text,claim_id::text,state,version,return_round,started_at,signed_at`

func scanVisit(row pgx.Row) (v domain.Visit, e error) {
	e = row.Scan(&v.ID, &v.AppointmentID, &v.PatientID, &v.DoctorUserID, &v.DepartmentID, &v.ClaimID, &v.State, &v.Version, &v.ReturnRound, &v.StartedAt, &v.SignedAt)
	return
}
func (t clinicalTx) Visit(ctx context.Context, id string) (v domain.Visit, e error) {
	v, e = scanVisit(t.tx.QueryRow(ctx, `SELECT `+visitColumns+` FROM visits WHERE id=$1 FOR UPDATE`, id))
	if errors.Is(e, pgx.ErrNoRows) {
		e = domain.Fail("NOT_FOUND", "Visit not found")
	}
	return
}
func (t clinicalTx) VisitByAppointment(ctx context.Context, id string) (v domain.Visit, found bool, e error) {
	if _, e = t.tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "appointment:"+id); e != nil {
		return
	}
	v, e = scanVisit(t.tx.QueryRow(ctx, `SELECT `+visitColumns+` FROM visits WHERE appointment_id=$1 FOR UPDATE`, id))
	if errors.Is(e, pgx.ErrNoRows) {
		e = nil
		return
	}
	found = e == nil
	return
}
func (t clinicalTx) InsertVisit(ctx context.Context, v domain.Visit) error {
	_, e := t.tx.Exec(ctx, `INSERT INTO visits(id,appointment_id,patient_id,doctor_user_id,department_id,claim_id,state,version,return_round,started_at,signed_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, v.ID, v.AppointmentID, v.PatientID, v.DoctorUserID, v.DepartmentID, v.ClaimID, v.State, v.Version, v.ReturnRound, v.StartedAt, v.SignedAt)
	return e
}
func (t clinicalTx) UpdateVisit(ctx context.Context, v domain.Visit) error {
	_, e := t.tx.Exec(ctx, `UPDATE visits SET claim_id=$2,state=$3,version=$4,return_round=$5,signed_at=$6 WHERE id=$1`, v.ID, v.ClaimID, v.State, v.Version, v.ReturnRound, v.SignedAt)
	return e
}
func (t clinicalTx) AppendNote(ctx context.Context, n domain.VisitNote) error {
	_, e := t.tx.Exec(ctx, `INSERT INTO visit_notes(id,visit_id,revision,symptoms,findings,assessment,diagnosis,author_user_id,saved_at) SELECT $1,$2,COALESCE(MAX(revision),0)+1,$3,$4,$5,$6,$7,$8 FROM visit_notes WHERE visit_id=$2`, n.ID, n.VisitID, n.Symptoms, n.Findings, n.Assessment, n.Diagnosis, n.AuthorUserID, n.SavedAt)
	return e
}
func (t clinicalTx) Notes(ctx context.Context, id string) (items []domain.VisitNote, e error) {
	items = []domain.VisitNote{}
	rows, e := t.tx.Query(ctx, `SELECT id::text,visit_id::text,revision,symptoms,findings,assessment,diagnosis,author_user_id::text,saved_at FROM visit_notes WHERE visit_id=$1 ORDER BY revision`, id)
	if e != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var n domain.VisitNote
		if e = rows.Scan(&n.ID, &n.VisitID, &n.Revision, &n.Symptoms, &n.Findings, &n.Assessment, &n.Diagnosis, &n.AuthorUserID, &n.SavedAt); e != nil {
			return
		}
		items = append(items, n)
	}
	e = rows.Err()
	return
}
func (t clinicalTx) Worklist(ctx context.Context, actor string, q domain.WorklistQuery) (result domain.Worklist, e error) {
	result.Items = []domain.Visit{}
	const filter = `doctor_user_id=$1 AND ($2='' OR (started_at AT TIME ZONE 'UTC')::date=NULLIF($2,'')::date) AND ($3='' OR state=$3)`
	if e = t.tx.QueryRow(ctx, `SELECT count(*) FROM visits WHERE `+filter, actor, q.Date, q.State).Scan(&result.Total); e != nil {
		return
	}
	rows, e := t.tx.Query(ctx, `SELECT `+visitColumns+` FROM visits WHERE `+filter+` ORDER BY started_at DESC,id LIMIT $4 OFFSET $5`, actor, q.Date, q.State, q.Limit, (q.Page-1)*q.Limit)
	if e != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		v, err := scanVisit(rows)
		if err != nil {
			return result, err
		}
		result.Items = append(result.Items, v)
	}
	e = rows.Err()
	return
}
func (t clinicalTx) SeenMessage(ctx context.Context, id, hash, leaseID string) (seen bool, e error) {
	if _, e = t.tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "message:"+id); e != nil {
		return
	}
	var prior, status string
	e = t.tx.QueryRow(ctx, `SELECT payload_hash,status FROM inbox WHERE message_id=$1`, id).Scan(&prior, &status)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return
	}
	if prior != hash {
		return false, domain.Fail("INVALID_MESSAGE", "Message ID reused with different content")
	}
	if status != "RETRY_SCHEDULED" || leaseID == "" {
		return true, nil
	}
	var leased bool
	e = t.tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM retry_jobs WHERE message_id=$1 AND lease_id=$2 AND lease_until>now() AND status='PENDING')`, id, leaseID).Scan(&leased)
	if e != nil {
		return false, e
	}
	if !leased {
		return false, domain.Fail("INVALID_MESSAGE", "Scheduled retry requires its current database lease")
	}
	return false, nil
}
func (t clinicalTx) MarkMessage(ctx context.Context, id, hash string) error {
	_, e := t.tx.Exec(ctx, `INSERT INTO inbox(message_id,payload_hash)VALUES($1,$2) ON CONFLICT(message_id)DO UPDATE SET status='PROCESSED',processed_at=now() WHERE inbox.payload_hash=EXCLUDED.payload_hash`, id, hash)
	return e
}
func (t clinicalTx) UpdateAccess(ctx context.Context, a domain.Access, version int) error {
	_, e := t.tx.Exec(ctx, `INSERT INTO user_access_projection(user_id,actor_type,status,token_version,source_version)VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id)DO UPDATE SET actor_type=EXCLUDED.actor_type,status=EXCLUDED.status,token_version=EXCLUDED.token_version,source_version=EXCLUDED.source_version,applied_at=now() WHERE user_access_projection.source_version<EXCLUDED.source_version`, a.UserID, a.ActorType, a.Status, a.TokenVersion, version)
	return e
}
func (t clinicalTx) UpdatePatientAccess(ctx context.Context, a domain.PatientAccess) error {
	_, e := t.tx.Exec(ctx, `INSERT INTO patient_access_projection(patient_id,owner_user_id,active,policy_version)VALUES($1,$2,$3,$4) ON CONFLICT(patient_id)DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id,active=EXCLUDED.active,policy_version=EXCLUDED.policy_version,applied_at=now() WHERE patient_access_projection.policy_version<EXCLUDED.policy_version`, a.PatientID, a.OwnerUserID, a.Active, a.PolicyVersion)
	return e
}
