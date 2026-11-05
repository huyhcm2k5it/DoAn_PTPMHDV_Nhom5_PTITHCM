package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"umccare/clinical/internal/domain"
	"umccare/clinical/migrations"
)

func migrateTreatment(ctx context.Context, tx pgx.Tx) error {
	var exists bool
	if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version='000002_treatment')`).Scan(&exists); e != nil {
		return e
	}
	if exists {
		return nil
	}
	raw, e := treatmentMigration()
	if e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, string(raw)); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO schema_migrations(version)VALUES('000002_treatment')`)
	return e
}

func (t clinicalTx) Prescription(ctx context.Context, id string) (p domain.Prescription, e error) {
	var raw []byte
	e = t.tx.QueryRow(ctx, `SELECT id::text,visit_id::text,patient_id::text,state,version,revision,lines,finalized_at FROM prescriptions WHERE id=$1`, id).Scan(&p.ID, &p.VisitID, &p.PatientID, &p.State, &p.Version, &p.Revision, &raw, &p.FinalizedAt)
	if errors.Is(e, pgx.ErrNoRows) {
		return p, domain.Fail("NOT_FOUND", "Prescription not found")
	}
	if e == nil {
		e = json.Unmarshal(raw, &p.Lines)
	}
	return
}
func (t clinicalTx) Prescriptions(ctx context.Context, id string) (out []domain.Prescription, e error) {
	out = []domain.Prescription{}
	rows, e := t.tx.Query(ctx, `SELECT id::text,visit_id::text,patient_id::text,state,version,revision,lines,finalized_at FROM prescriptions WHERE visit_id=$1 ORDER BY id`, id)
	if e != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var p domain.Prescription
		var raw []byte
		if e = rows.Scan(&p.ID, &p.VisitID, &p.PatientID, &p.State, &p.Version, &p.Revision, &raw, &p.FinalizedAt); e != nil {
			return
		}
		if e = json.Unmarshal(raw, &p.Lines); e != nil {
			return
		}
		out = append(out, p)
	}
	e = rows.Err()
	return
}
func (t clinicalTx) SavePrescription(ctx context.Context, p domain.Prescription) error {
	raw, e := json.Marshal(p.Lines)
	if e != nil {
		return e
	}
	_, e = t.tx.Exec(ctx, `INSERT INTO prescriptions(id,visit_id,patient_id,state,version,revision,lines,finalized_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,version=EXCLUDED.version,revision=EXCLUDED.revision,lines=EXCLUDED.lines,finalized_at=EXCLUDED.finalized_at`, p.ID, p.VisitID, p.PatientID, p.State, p.Version, p.Revision, raw, p.FinalizedAt)
	return e
}
func (t clinicalTx) Medicine(ctx context.Context, code string) (v domain.CatalogEntity, e error) {
	e = t.tx.QueryRow(ctx, `SELECT entity_id::text,code,name,unit,reference_range,revision,status FROM catalog_entity_projection WHERE entity_type='MEDICINE' AND code=$1 FOR SHARE`, code).Scan(&v.ID, &v.Code, &v.Name, &v.Unit, &v.ReferenceRange, &v.Revision, &v.Status)
	if errors.Is(e, pgx.ErrNoRows) {
		e = domain.Fail("SERVICE_UNAVAILABLE", "Medicine projection unavailable")
	}
	return
}
func (t clinicalTx) LabTest(ctx context.Context, id string) (v domain.CatalogEntity, e error) {
	e = t.tx.QueryRow(ctx, `SELECT entity_id::text,code,name,unit,reference_range,revision,status FROM catalog_entity_projection WHERE entity_type='LAB_TEST' AND entity_id=$1 FOR SHARE`, id).Scan(&v.ID, &v.Code, &v.Name, &v.Unit, &v.ReferenceRange, &v.Revision, &v.Status)
	if errors.Is(e, pgx.ErrNoRows) {
		e = domain.Fail("SERVICE_UNAVAILABLE", "Lab test projection unavailable")
	}
	return
}
func (t clinicalTx) PutCatalog(ctx context.Context, kind string, v domain.CatalogEntity) error {
	_, e := t.tx.Exec(ctx, `INSERT INTO catalog_entity_projection(entity_type,entity_id,code,name,unit,reference_range,revision,status)VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(entity_type,entity_id) DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name,unit=EXCLUDED.unit,reference_range=EXCLUDED.reference_range,revision=EXCLUDED.revision,status=EXCLUDED.status WHERE catalog_entity_projection.revision<EXCLUDED.revision`, kind, v.ID, v.Code, v.Name, v.Unit, v.ReferenceRange, v.Revision, v.Status)
	return e
}
func (t clinicalTx) LabRequests(ctx context.Context, id string) (out []domain.LabRequest, e error) {
	out = []domain.LabRequest{}
	rows, e := t.tx.Query(ctx, `SELECT request_id::text,visit_id::text,state,COALESCE(order_id::text,''),reason_code,request_hash,source_version,tests FROM lab_requests WHERE visit_id=$1 ORDER BY request_id`, id)
	if e != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var r domain.LabRequest
		var raw []byte
		if e = rows.Scan(&r.RequestID, &r.VisitID, &r.State, &r.OrderID, &r.ReasonCode, &r.RequestHash, &r.SourceVersion, &raw); e != nil {
			return
		}
		if e = json.Unmarshal(raw, &r.Tests); e != nil {
			return
		}
		out = append(out, r)
	}
	e = rows.Err()
	return
}
func (t clinicalTx) LabRequest(ctx context.Context, id string) (r domain.LabRequest, e error) {
	var raw []byte
	e = t.tx.QueryRow(ctx, `SELECT request_id::text,visit_id::text,state,COALESCE(order_id::text,''),reason_code,request_hash,source_version,tests FROM lab_requests WHERE request_id=$1`, id).Scan(&r.RequestID, &r.VisitID, &r.State, &r.OrderID, &r.ReasonCode, &r.RequestHash, &r.SourceVersion, &raw)
	if errors.Is(e, pgx.ErrNoRows) {
		return r, domain.Fail("SERVICE_UNAVAILABLE", "Lab request not yet available")
	}
	if e == nil {
		e = json.Unmarshal(raw, &r.Tests)
	}
	return
}
func (t clinicalTx) SaveLabRequest(ctx context.Context, r domain.LabRequest) error {
	raw, e := json.Marshal(r.Tests)
	if e != nil {
		return e
	}
	_, e = t.tx.Exec(ctx, `INSERT INTO lab_requests(request_id,visit_id,state,order_id,reason_code,request_hash,source_version,tests)VALUES($1,$2,$3,NULLIF($4,'')::uuid,$5,$6,$7,$8) ON CONFLICT(request_id) DO UPDATE SET state=EXCLUDED.state,order_id=EXCLUDED.order_id,reason_code=EXCLUDED.reason_code,source_version=EXCLUDED.source_version`, r.RequestID, r.VisitID, r.State, r.OrderID, r.ReasonCode, r.RequestHash, r.SourceVersion, raw)
	return e
}
func (t clinicalTx) DoctorID(ctx context.Context, visit string) (id string, e error) {
	e = t.tx.QueryRow(ctx, `SELECT (s.ticket_snapshot->>'doctorId') FROM start_requests s WHERE s.visit_id=$1 AND s.state='ACCEPTED' ORDER BY s.created_at DESC LIMIT 1`, visit).Scan(&id)
	if errors.Is(e, pgx.ErrNoRows) {
		e = domain.Fail("SERVICE_UNAVAILABLE", "Doctor mapping unavailable")
	}
	return
}
func (t clinicalTx) AppendMessage(ctx context.Context, m domain.Envelope, exchange, route string) error {
	raw, e := json.Marshal(m)
	if e != nil {
		return e
	}
	_, e = t.tx.Exec(ctx, `INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope)VALUES($1,$2,$3,$4,$5)`, m.MessageID, m.AggregateID, exchange, route, raw)
	return e
}

func treatmentMigration() ([]byte, error) {
	return migrations.Files.ReadFile("000002_treatment.up.sql")
}
