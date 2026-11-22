package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"umccare/clinical/internal/domain"
)

func (t clinicalTx) LabTerminal(ctx context.Context, request string) (v domain.LabTerminal, found bool, err error) {
	var revision *int
	var publishedAt *time.Time
	err = t.tx.QueryRow(ctx, `SELECT request_id::text,visit_id::text,order_id::text,state,semantic_hash,revision,published_at FROM lab_terminal_projection WHERE request_id=$1`, request).Scan(&v.RequestID, &v.VisitID, &v.OrderID, &v.State, &v.Hash, &revision, &publishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, false, nil
	}
	if revision != nil {
		v.Revision = *revision
	}
	if publishedAt != nil {
		v.PublishedAt = publishedAt.UTC()
	}
	return v, err == nil, err
}

func (t clinicalTx) SaveLabTerminal(ctx context.Context, v domain.LabTerminal) error {
	old, found, err := t.LabTerminal(ctx, v.RequestID)
	if err != nil {
		return err
	}
	if found {
		if old.RequestID != v.RequestID || old.VisitID != v.VisitID || old.OrderID != v.OrderID || old.State != v.State || old.Hash != v.Hash || old.Revision != v.Revision || !old.PublishedAt.Equal(v.PublishedAt) {
			return domain.Fail("STATE_CONFLICT", "Conflicting LAB terminal event")
		}
		return nil
	}
	var publishedAt *time.Time
	if !v.PublishedAt.IsZero() {
		publishedAt = &v.PublishedAt
	}
	_, err = t.tx.Exec(ctx, `INSERT INTO lab_terminal_projection(request_id,visit_id,order_id,state,semantic_hash,revision,published_at) VALUES($1,$2,$3,$4,$5,NULLIF($6,0),$7)`, v.RequestID, v.VisitID, v.OrderID, v.State, v.Hash, v.Revision, publishedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return domain.Fail("STATE_CONFLICT", "LAB order already belongs to another request")
	}
	return err
}

func (t clinicalTx) CatalogStream(ctx context.Context) (sequence, highest int64, checkpoint *time.Time, err error) {
	err = t.tx.QueryRow(ctx, `SELECT sequence,highest_observed,checkpoint_at FROM catalog_stream_state WHERE singleton=true FOR UPDATE`).Scan(&sequence, &highest, &checkpoint)
	return
}

func (t clinicalTx) SaveCatalogStream(ctx context.Context, sequence, highest int64, checkpoint *time.Time) error {
	_, err := t.tx.Exec(ctx, `UPDATE catalog_stream_state SET sequence=$1,highest_observed=$2,checkpoint_at=$3 WHERE singleton=true`, sequence, highest, checkpoint)
	return err
}

func (t clinicalTx) Prescription(ctx context.Context, id string) (p domain.Prescription, e error) {
	e = t.tx.QueryRow(ctx, `SELECT p.id::text,p.visit_id::text,v.patient_id::text,p.state,p.version,p.revision,p.finalized_at,COALESCE(p.finalized_by::text,'') FROM prescriptions AS p JOIN visits AS v ON v.id=p.visit_id WHERE p.id=$1`, id).Scan(&p.ID, &p.VisitID, &p.PatientID, &p.State, &p.Version, &p.Revision, &p.FinalizedAt, &p.FinalizedBy)
	if errors.Is(e, pgx.ErrNoRows) {
		return p, domain.Fail("NOT_FOUND", "Prescription not found")
	}
	if e == nil {
		p.Lines, e = t.prescriptionItems(ctx, p.ID)
	}
	return
}
func (t clinicalTx) Prescriptions(ctx context.Context, id string) (out []domain.Prescription, e error) {
	out = []domain.Prescription{}
	rows, e := t.tx.Query(ctx, `SELECT p.id::text,p.visit_id::text,v.patient_id::text,p.state,p.version,p.revision,p.finalized_at,COALESCE(p.finalized_by::text,'') FROM prescriptions AS p JOIN visits AS v ON v.id=p.visit_id WHERE p.visit_id=$1 ORDER BY p.revision,p.id`, id)
	if e != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var p domain.Prescription
		if e = rows.Scan(&p.ID, &p.VisitID, &p.PatientID, &p.State, &p.Version, &p.Revision, &p.FinalizedAt, &p.FinalizedBy); e != nil {
			return
		}
		out = append(out, p)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return
	}
	for i := range out {
		if out[i].Lines, e = t.prescriptionItems(ctx, out[i].ID); e != nil {
			return
		}
	}
	return
}

func (t clinicalTx) prescriptionItems(ctx context.Context, id string) ([]domain.PrescriptionLine, error) {
	rows, err := t.tx.Query(ctx, `SELECT id::text,medicine_id::text,medicine_code_snapshot,name_snapshot,dose_text,quantity,instruction FROM prescription_items WHERE prescription_id=$1 ORDER BY position,id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.PrescriptionLine{}
	for rows.Next() {
		var line domain.PrescriptionLine
		if err = rows.Scan(&line.ID, &line.MedicineID, &line.MedicineCode, &line.NameSnapshot, &line.DoseText, &line.Quantity, &line.Instruction); err != nil {
			return nil, err
		}
		items = append(items, line)
	}
	return items, rows.Err()
}

func (t clinicalTx) NextPrescriptionRevision(ctx context.Context, visitID, currentID string, currentRevision int) (int, error) {
	var revision int
	err := t.tx.QueryRow(ctx, `SELECT GREATEST(COALESCE(max(revision),0),$3)+1 FROM prescriptions WHERE visit_id=$1 AND ($2='' OR id<>NULLIF($2,'')::uuid)`, visitID, currentID, currentRevision).Scan(&revision)
	return revision, err
}

func (t clinicalTx) SavePrescription(ctx context.Context, p domain.Prescription) error {
	tag, err := t.tx.Exec(ctx, `INSERT INTO prescriptions(id,visit_id,state,version,revision,finalized_at,finalized_by)VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,'')::uuid) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,version=EXCLUDED.version,revision=EXCLUDED.revision,finalized_at=EXCLUDED.finalized_at,finalized_by=EXCLUDED.finalized_by WHERE prescriptions.visit_id=EXCLUDED.visit_id`, p.ID, p.VisitID, p.State, p.Version, p.Revision, p.FinalizedAt, p.FinalizedBy)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return domain.Fail("STATE_CONFLICT", "Prescription visit cannot change")
	}
	if _, err = t.tx.Exec(ctx, `DELETE FROM prescription_items WHERE prescription_id=$1`, p.ID); err != nil {
		return err
	}
	for position, line := range p.Lines {
		itemID := line.ID
		if !domain.ValidID(itemID) {
			itemID = domain.NewID()
		}
		if !domain.ValidID(line.MedicineID) {
			return domain.Fail("SERVICE_UNAVAILABLE", "Medicine identity projection is unavailable")
		}
		if _, err = t.tx.Exec(ctx, `INSERT INTO prescription_items(id,prescription_id,medicine_id,medicine_code_snapshot,name_snapshot,dose_text,quantity,instruction,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, itemID, p.ID, line.MedicineID, line.MedicineCode, line.NameSnapshot, line.DoseText, line.Quantity, line.Instruction, position); err != nil {
			return err
		}
	}
	return nil
}
func (t clinicalTx) Medicine(ctx context.Context, code string) (v domain.CatalogEntity, e error) {
	if e = t.requireFreshCatalog(ctx); e != nil {
		return
	}
	e = t.tx.QueryRow(ctx, `SELECT entity_id::text,code,name,unit,reference_range,revision,status FROM catalog_entity_projection WHERE entity_type='MEDICINE' AND code=$1 FOR SHARE`, code).Scan(&v.ID, &v.Code, &v.Name, &v.Unit, &v.ReferenceRange, &v.Revision, &v.Status)
	if errors.Is(e, pgx.ErrNoRows) {
		e = domain.Fail("SERVICE_UNAVAILABLE", "Medicine projection unavailable")
	}
	return
}
func (t clinicalTx) LabTest(ctx context.Context, id string) (v domain.CatalogEntity, e error) {
	if e = t.requireFreshCatalog(ctx); e != nil {
		return
	}
	e = t.tx.QueryRow(ctx, `SELECT entity_id::text,code,name,unit,reference_range,revision,status FROM catalog_entity_projection WHERE entity_type='LAB_TEST' AND entity_id=$1 FOR SHARE`, id).Scan(&v.ID, &v.Code, &v.Name, &v.Unit, &v.ReferenceRange, &v.Revision, &v.Status)
	if errors.Is(e, pgx.ErrNoRows) {
		e = domain.Fail("SERVICE_UNAVAILABLE", "Lab test projection unavailable")
	}
	return
}

func (t clinicalTx) requireFreshCatalog(ctx context.Context) error {
	var sequence, highest int64
	var checkpoint *time.Time
	if err := t.tx.QueryRow(ctx, `SELECT sequence,highest_observed,checkpoint_at FROM catalog_stream_state WHERE singleton=true FOR SHARE`).Scan(&sequence, &highest, &checkpoint); err != nil {
		return domain.Fail("SERVICE_UNAVAILABLE", "Catalog stream projection unavailable")
	}
	now := time.Now().UTC()
	if checkpoint == nil || highest > sequence || checkpoint.After(now.Add(time.Second)) || now.Sub(*checkpoint) > 30*time.Second {
		return domain.Fail("SERVICE_UNAVAILABLE", "Catalog stream is missing, gapped or stale")
	}
	return nil
}
func (t clinicalTx) PutCatalog(ctx context.Context, kind string, v domain.CatalogEntity) error {
	_, e := t.tx.Exec(ctx, `INSERT INTO catalog_entity_projection(entity_type,entity_id,code,name,unit,reference_range,revision,status)VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(entity_type,entity_id) DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name,unit=EXCLUDED.unit,reference_range=EXCLUDED.reference_range,revision=EXCLUDED.revision,status=EXCLUDED.status WHERE catalog_entity_projection.revision<EXCLUDED.revision OR (catalog_entity_projection.revision=EXCLUDED.revision AND catalog_entity_projection.status='ACTIVE' AND EXCLUDED.status='INACTIVE')`, kind, v.ID, v.Code, v.Name, v.Unit, v.ReferenceRange, v.Revision, v.Status)
	return e
}
func (t clinicalTx) LabRequests(ctx context.Context, id string) (out []domain.LabRequest, e error) {
	out = []domain.LabRequest{}
	rows, e := t.tx.Query(ctx, `SELECT id::text,visit_id::text,state,COALESCE(order_id::text,''),reason_code,request_hash,source_version,test_snapshot FROM lab_requests WHERE visit_id=$1 ORDER BY id`, id)
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
	e = t.tx.QueryRow(ctx, `SELECT id::text,visit_id::text,state,COALESCE(order_id::text,''),reason_code,request_hash,source_version,test_snapshot FROM lab_requests WHERE id=$1`, id).Scan(&r.RequestID, &r.VisitID, &r.State, &r.OrderID, &r.ReasonCode, &r.RequestHash, &r.SourceVersion, &raw)
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
	_, e = t.tx.Exec(ctx, `INSERT INTO lab_requests(id,visit_id,state,order_id,reason_code,request_hash,source_version,test_snapshot)VALUES($1,$2,$3,NULLIF($4,'')::uuid,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,order_id=EXCLUDED.order_id,reason_code=EXCLUDED.reason_code,source_version=EXCLUDED.source_version,version=lab_requests.version+1 WHERE (lab_requests.state,lab_requests.order_id,lab_requests.reason_code,lab_requests.source_version) IS DISTINCT FROM (EXCLUDED.state,EXCLUDED.order_id,EXCLUDED.reason_code,EXCLUDED.source_version)`, r.RequestID, r.VisitID, r.State, r.OrderID, r.ReasonCode, r.RequestHash, r.SourceVersion, raw)
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
