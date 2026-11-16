package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"time"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/application/projection"
	"umccare/diagnostic/internal/domain"
	"umccare/diagnostic/migrations"
)

type diagnosticTx struct{ tx pgx.Tx }

func (p *Probe) Migrate(ctx context.Context) error {
	tx, e := p.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('diagnostic:migrate',0));CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY)`); e != nil {
		return e
	}
	for _, version := range []string{"000001_diagnostic", "000002_visit_subjects", "000003_diagnostic_erd_alignment"} {
		var exists bool
		if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)`, version).Scan(&exists); e != nil {
			return e
		}
		if exists {
			continue
		}
		b, readErr := migrations.Files.ReadFile(version + ".up.sql")
		if readErr != nil {
			return readErr
		}
		if _, e = tx.Exec(ctx, string(b)); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `INSERT INTO schema_migrations VALUES($1)`, version); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
func (p *Probe) BusinessReady(ctx context.Context) error {
	var b bool
	e := p.pool.QueryRow(ctx, `SELECT count(*)=3 FROM schema_migrations WHERE version IN ('000001_diagnostic','000002_visit_subjects','000003_diagnostic_erd_alignment')`).Scan(&b)
	if e != nil || !b {
		return domain.Fail("SERVICE_UNAVAILABLE", "Diagnostic migrations required")
	}
	return nil
}
func (p *Probe) Within(ctx context.Context, lock string, fn func(ports.Tx) error) error {
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
	if e = fn(diagnosticTx{tx}); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (t diagnosticTx) Get(ctx context.Context, kind, key string) (json.RawMessage, error) {
	if kind == "result" {
		return t.getResult(ctx, key)
	}
	if kind == "result-order" {
		var id string
		err := t.tx.QueryRow(ctx, `SELECT id::text FROM results WHERE order_id=$1`, key).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.Fail("NOT_FOUND", "Record not found")
		}
		if err != nil {
			return nil, err
		}
		return json.Marshal(id)
	}
	var b []byte
	e := t.tx.QueryRow(ctx, `SELECT value FROM objects WHERE kind=$1 AND key=$2 FOR UPDATE`, kind, key).Scan(&b)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, domain.Fail("NOT_FOUND", "Record not found")
	}
	return b, e
}
func (t diagnosticTx) Put(ctx context.Context, kind, key string, v any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	if kind == "result" {
		return t.putResult(ctx, key, b)
	}
	if kind == "result-order" {
		var resultID string
		if e = json.Unmarshal(b, &resultID); e != nil {
			return e
		}
		var matches bool
		if e = t.tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM results WHERE id=$1 AND order_id=$2)`, resultID, key).Scan(&matches); e != nil {
			return e
		}
		if !matches {
			return domain.Fail("STATE_CONFLICT", "Result and order mapping do not match")
		}
		return nil
	}
	if kind == "result-audit" {
		var audit struct {
			ResultID string    `json:"resultId"`
			Action   string    `json:"action"`
			ActorID  string    `json:"actorId"`
			Reason   string    `json:"reason"`
			At       time.Time `json:"at"`
		}
		if e = json.Unmarshal(b, &audit); e != nil {
			return e
		}
		if audit.Action == "DI-010" || audit.Action == "DI-011" {
			decision := map[string]string{"DI-010": "REWORK", "DI-011": "PUBLISHED"}[audit.Action]
			if _, e = t.tx.Exec(ctx, `INSERT INTO reviews(id,result_id,reviewer_user_id,decision,reason,reviewed_at) VALUES($1,$2,$3,$4,NULLIF($5,''),$6)`, key, audit.ResultID, audit.ActorID, decision, audit.Reason, audit.At); e != nil {
				return e
			}
		}
	}
	_, e = t.tx.Exec(ctx, `INSERT INTO objects(kind,key,value)VALUES($1,$2,$3)ON CONFLICT(kind,key)DO UPDATE SET value=EXCLUDED.value`, kind, key, b)
	return e
}

type persistedResult struct {
	Result       domain.Result `json:"result"`
	Contributors []string      `json:"contributors"`
}

func (t diagnosticTx) getResult(ctx context.Context, id string) (json.RawMessage, error) {
	var stored persistedResult
	err := t.tx.QueryRow(ctx, `SELECT id::text,order_id::text,specimen_id::text,revision,state,entered_by::text,submitted_at,published_at,version FROM results WHERE id=$1 FOR UPDATE`, id).Scan(&stored.Result.ID, &stored.Result.OrderID, &stored.Result.SpecimenID, &stored.Result.Revision, &stored.Result.State, &stored.Result.EnteredBy, &stored.Result.SubmittedAt, &stored.Result.PublishedAt, &stored.Result.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.Fail("NOT_FOUND", "Result not found")
	}
	if err != nil {
		return nil, err
	}
	rows, err := t.tx.Query(ctx, `SELECT item.id::text,item.test_code,item.value_text,COALESCE(snapshot.value->>'unit',''),COALESCE(snapshot.value->>'referenceRange',''),COALESCE(item.flag,'')
		FROM result_items AS item
		JOIN results AS result ON result.id=item.result_id
		JOIN lab_orders AS orders ON orders.id=result.order_id
		LEFT JOIN LATERAL jsonb_array_elements(orders.test_snapshot) AS snapshot(value) ON snapshot.value->>'code'=item.test_code
		WHERE item.result_id=$1 ORDER BY item.position FOR UPDATE OF item`, id)
	if err != nil {
		return nil, err
	}
	stored.Result.Items = []domain.ResultItem{}
	for rows.Next() {
		var item domain.ResultItem
		if err = rows.Scan(&item.ID, &item.TestCode, &item.ValueText, &item.Unit, &item.ReferenceRange, &item.Flag); err != nil {
			rows.Close()
			return nil, err
		}
		stored.Result.Items = append(stored.Result.Items, item)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	rows, err = t.tx.Query(ctx, `SELECT contributor_user_id::text FROM result_contributors WHERE result_id=$1 ORDER BY contributor_user_id FOR UPDATE`, id)
	if err != nil {
		return nil, err
	}
	stored.Contributors = []string{}
	for rows.Next() {
		var contributor string
		if err = rows.Scan(&contributor); err != nil {
			rows.Close()
			return nil, err
		}
		stored.Contributors = append(stored.Contributors, contributor)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	return json.Marshal(stored)
}

func (t diagnosticTx) putResult(ctx context.Context, id string, raw []byte) error {
	var stored persistedResult
	if err := json.Unmarshal(raw, &stored); err != nil {
		return err
	}
	r := stored.Result
	tag, err := t.tx.Exec(ctx, `INSERT INTO results(id,order_id,specimen_id,revision,state,entered_by,submitted_at,published_at,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,state=EXCLUDED.state,entered_by=EXCLUDED.entered_by,submitted_at=EXCLUDED.submitted_at,published_at=EXCLUDED.published_at,version=EXCLUDED.version
		WHERE results.order_id=EXCLUDED.order_id AND results.specimen_id=EXCLUDED.specimen_id`, r.ID, r.OrderID, r.SpecimenID, r.Revision, r.State, r.EnteredBy, r.SubmittedAt, r.PublishedAt, r.Version)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return domain.Fail("STATE_CONFLICT", "Result identity cannot change its order or specimen")
	}
	if _, err = t.tx.Exec(ctx, `DELETE FROM result_items WHERE result_id=$1`, r.ID); err != nil {
		return err
	}
	for position, item := range r.Items {
		itemID := item.ID
		if !domain.ValidID(itemID) {
			itemID = domain.NewID()
		}
		if _, err = t.tx.Exec(ctx, `INSERT INTO result_items(id,result_id,test_code,value_text,flag,position) VALUES($1,$2,$3,$4,NULLIF($5,''),$6)`, itemID, r.ID, item.TestCode, item.ValueText, item.Flag, position); err != nil {
			return err
		}
	}
	if _, err = t.tx.Exec(ctx, `DELETE FROM result_contributors WHERE result_id=$1`, r.ID); err != nil {
		return err
	}
	for _, contributor := range stored.Contributors {
		if !domain.ValidID(contributor) {
			return domain.Fail("INVALID_MESSAGE", "Result contributor must be a UUID")
		}
		if _, err = t.tx.Exec(ctx, `INSERT INTO result_contributors(result_id,contributor_user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, r.ID, contributor); err != nil {
			return err
		}
	}
	return nil
}
func (t diagnosticTx) Orders(ctx context.Context) ([]domain.Order, error) {
	rows, e := t.tx.Query(ctx, `SELECT orders.id::text,orders.clinical_request_id::text,orders.request_hash,
		orders.visit_id::text,subject.patient_id::text,COALESCE(orders.doctor_id::text,''),orders.state,orders.version,
		orders.source_revision,COALESCE(orders.charge_id::text,''),orders.charge_state,COALESCE(orders.charge_request_id::text,''),
		orders.amount_vnd,orders.amount_hash,orders.price_snapshot,orders.test_snapshot,COALESCE(orders.settlement_id::text,''),
		orders.settlement_state,orders.settlement_version,orders.attempt_version,orders.last_query_at,orders.refund_status,orders.created_at
		FROM lab_orders AS orders
		JOIN diagnostic_visit_subjects AS subject ON subject.visit_id=orders.visit_id
		ORDER BY orders.id FOR UPDATE OF orders`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []domain.Order{}
	for rows.Next() {
		var o domain.Order
		var prices, tests []byte
		if e = rows.Scan(&o.ID, &o.RequestID, &o.RequestHash, &o.VisitID, &o.PatientID, &o.DoctorID, &o.State, &o.Version,
			&o.SourceRevision, &o.ChargeID, &o.ChargeState, &o.ChargeRequestID, &o.AmountVND, &o.AmountHash, &prices, &tests,
			&o.SettlementID, &o.SettlementState, &o.Fence, &o.AttemptVersion, &o.LastQueryAt, &o.RefundStatus, &o.CreatedAt); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(prices, &o.Lines); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(tests, &o.Tests); e != nil {
			return nil, e
		}
		items = append(items, o)
	}
	if e = rows.Err(); e != nil {
		rows.Close()
		return nil, e
	}
	rows.Close()
	for i := range items {
		items[i].Specimens, e = t.orderSpecimens(ctx, items[i].ID)
		if e != nil {
			return nil, e
		}
	}
	return items, nil
}

func (t diagnosticTx) orderSpecimens(ctx context.Context, orderID string) ([]domain.Specimen, error) {
	rows, err := t.tx.Query(ctx, `SELECT id::text,order_id::text,state,sequence,barcode,version,collected_by::text,collected_at,COALESCE(reject_reason,'') FROM specimens WHERE order_id=$1 ORDER BY sequence,id FOR UPDATE`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.Specimen{}
	for rows.Next() {
		var specimen domain.Specimen
		if err = rows.Scan(&specimen.ID, &specimen.OrderID, &specimen.State, &specimen.Sequence, &specimen.Barcode, &specimen.Version, &specimen.CollectedBy, &specimen.CollectedAt, &specimen.ReasonCode); err != nil {
			return nil, err
		}
		items = append(items, specimen)
	}
	return items, rows.Err()
}

func (t diagnosticTx) PublishedResultsForPatient(ctx context.Context, patientID string, page, limit int) (domain.PublishedResults, error) {
	return t.publishedResults(ctx, patientID, "", page, limit)
}

func (t diagnosticTx) VerifyVisitGrant(ctx context.Context, visitID, patientID, doctorUserID string, cancel bool, now time.Time) error {
	if err := projection.RequireCurrentVisitStream(ctx, t, now); err != nil {
		return err
	}
	raw, err := t.Get(ctx, "visit_grant", domain.ID(visitID))
	if domain.Code(err) == "NOT_FOUND" {
		return domain.Fail("SERVICE_UNAVAILABLE", "Visit grant has not synchronized")
	}
	if err != nil {
		return err
	}
	var grant projection.VisitGrantEvent
	if json.Unmarshal(raw, &grant) != nil || grant.Active == nil || grant.CanCancel == nil {
		return domain.Fail("SERVICE_UNAVAILABLE", "Invalid visit grant projection")
	}
	if grant.PatientID != domain.ID(patientID) || grant.DoctorUserID != domain.ID(doctorUserID) || !*grant.Active {
		return domain.Fail("NOT_FOUND", "Order not found")
	}
	if cancel && !*grant.CanCancel {
		return domain.Fail("STATE_CONFLICT", "Signed visit cannot cancel LAB")
	}
	return nil
}

func (t diagnosticTx) PublishedResultsForDoctor(ctx context.Context, patientID, doctorUserID string, page, limit int, now time.Time) (domain.PublishedResults, error) {
	if err := projection.RequireCurrentVisitStream(ctx, t, now); err != nil {
		return domain.PublishedResults{}, err
	}
	return t.publishedResults(ctx, patientID, doctorUserID, page, limit)
}

func (t diagnosticTx) publishedResults(ctx context.Context, patientID, doctorUserID string, page, limit int) (domain.PublishedResults, error) {
	out := domain.PublishedResults{Items: []domain.Result{}}
	var raw []byte
	err := t.tx.QueryRow(ctx, `WITH eligible AS (
		SELECT result.id,result.order_id,result.specimen_id,result.revision,result.state,result.entered_by,
		       result.submitted_at,result.published_at,result.version,orders.test_snapshot,orders.visit_id,subject.patient_id
		FROM results AS result
		JOIN lab_orders AS orders ON orders.id=result.order_id
		JOIN diagnostic_visit_subjects AS subject ON subject.visit_id=orders.visit_id
		WHERE subject.patient_id=$1::uuid
		  AND result.state='PUBLISHED'
		  AND result.published_at IS NOT NULL
		  AND ($4='' OR EXISTS (
		      SELECT 1 FROM objects AS assignment
		      WHERE assignment.kind='visit_grant'
		        AND assignment.key=orders.visit_id::text
		        AND assignment.value->>'patientId'=subject.patient_id::text
		        AND assignment.value->>'doctorUserId'=$4
		        AND assignment.value->'active'='true'::jsonb
		  ))
	), page AS (
		SELECT eligible.id,eligible.published_at,
		       jsonb_build_object(
		         'id',eligible.id,'orderId',eligible.order_id,'specimenId',eligible.specimen_id,
		         'revision',eligible.revision,'state',eligible.state,'enteredBy',eligible.entered_by,
		         'submittedAt',eligible.submitted_at,'publishedAt',eligible.published_at,'version',eligible.version,
		         'items',COALESCE((
		           SELECT jsonb_agg(jsonb_build_object(
		             'id',item.id,'testCode',item.test_code,'valueText',item.value_text,
		             'unit',COALESCE(snapshot.value->>'unit',''),
		             'referenceRange',COALESCE(snapshot.value->>'referenceRange',''),
		             'flag',item.flag
		           ) ORDER BY item.position)
		           FROM result_items AS item
		           LEFT JOIN LATERAL (
		             SELECT test.value FROM jsonb_array_elements(eligible.test_snapshot) AS test(value)
		             WHERE test.value->>'code'=item.test_code LIMIT 1
		           ) AS snapshot ON true
		           WHERE item.result_id=eligible.id
		         ),'[]'::jsonb)
		       ) AS body
		FROM eligible
		ORDER BY eligible.published_at DESC,eligible.id DESC LIMIT $2 OFFSET $3
	)
	SELECT COALESCE((SELECT jsonb_agg(body ORDER BY published_at DESC,id DESC) FROM page),'[]'::jsonb),
	       (SELECT count(*) FROM eligible)`, patientID, limit, (page-1)*limit, doctorUserID).Scan(&raw, &out.Total)
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(raw, &out.Items)
	return out, err
}
func (t diagnosticTx) SaveOrder(ctx context.Context, o domain.Order) error {
	if !domain.ValidID(o.VisitID) || !domain.ValidID(o.PatientID) {
		return domain.Fail("STATE_CONFLICT", "LAB order requires a valid visit and patient")
	}
	prices, e := json.Marshal(o.Lines)
	if e != nil {
		return e
	}
	if o.Lines == nil {
		prices = []byte("[]")
	}
	tests, e := json.Marshal(o.Tests)
	if e != nil {
		return e
	}
	if o.Tests == nil {
		tests = []byte("[]")
	}
	if _, e = t.tx.Exec(ctx, `INSERT INTO diagnostic_visit_subjects(visit_id,patient_id)
		VALUES($1,$2) ON CONFLICT(visit_id) DO NOTHING`, o.VisitID, o.PatientID); e != nil {
		return e
	}
	var patient string
	if e = t.tx.QueryRow(ctx, `SELECT patient_id::text FROM diagnostic_visit_subjects
		WHERE visit_id=$1 FOR SHARE`, o.VisitID).Scan(&patient); e != nil {
		return e
	}
	if patient != domain.ID(o.PatientID) {
		return domain.Fail("STATE_CONFLICT", "LAB visit already belongs to another patient")
	}
	tag, e := t.tx.Exec(ctx, `INSERT INTO lab_orders(
		id,clinical_request_id,visit_id,state,charge_id,created_at,version,source_revision,doctor_id,charge_state,
		charge_request_id,amount_vnd,amount_hash,test_snapshot,price_snapshot,request_hash,settlement_id,settlement_state,
		settlement_version,attempt_version,last_query_at,refund_status
	) VALUES($1,$2,$3,$4,NULLIF($5,'')::uuid,$6,$7,$8,NULLIF($9,'')::uuid,$10,NULLIF($11,'')::uuid,$12,$13,$14,$15,$16,NULLIF($17,'')::uuid,$18,$19,$20,$21,$22)
	ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,charge_id=EXCLUDED.charge_id,created_at=EXCLUDED.created_at,
		version=EXCLUDED.version,source_revision=EXCLUDED.source_revision,doctor_id=EXCLUDED.doctor_id,charge_state=EXCLUDED.charge_state,
		charge_request_id=EXCLUDED.charge_request_id,amount_vnd=EXCLUDED.amount_vnd,amount_hash=EXCLUDED.amount_hash,
		test_snapshot=EXCLUDED.test_snapshot,price_snapshot=EXCLUDED.price_snapshot,request_hash=EXCLUDED.request_hash,
		settlement_id=EXCLUDED.settlement_id,settlement_state=EXCLUDED.settlement_state,settlement_version=EXCLUDED.settlement_version,
		attempt_version=EXCLUDED.attempt_version,last_query_at=EXCLUDED.last_query_at,refund_status=EXCLUDED.refund_status
	WHERE lab_orders.visit_id=EXCLUDED.visit_id AND lab_orders.clinical_request_id=EXCLUDED.clinical_request_id`,
		o.ID, o.RequestID, o.VisitID, o.State, o.ChargeID, o.CreatedAt, o.Version, o.SourceRevision, o.DoctorID, o.ChargeState,
		o.ChargeRequestID, o.AmountVND, o.AmountHash, tests, prices, o.RequestHash, o.SettlementID, o.SettlementState,
		o.Fence, o.AttemptVersion, o.LastQueryAt, o.RefundStatus)
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return domain.Fail("STATE_CONFLICT", "LAB order visit or clinical request cannot change")
	}
	for _, s := range o.Specimens {
		tag, e = t.tx.Exec(ctx, `INSERT INTO specimens(id,order_id,sequence,state,barcode,collected_at,collected_by,reject_reason,version)
			VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),$9)
			ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,collected_at=EXCLUDED.collected_at,collected_by=EXCLUDED.collected_by,
				reject_reason=EXCLUDED.reject_reason,version=EXCLUDED.version
			WHERE specimens.order_id=EXCLUDED.order_id AND specimens.sequence=EXCLUDED.sequence AND specimens.barcode=EXCLUDED.barcode`,
			s.ID, o.ID, s.Sequence, s.State, s.Barcode, s.CollectedAt, s.CollectedBy, s.ReasonCode, s.Version)
		if e != nil {
			return e
		}
		if tag.RowsAffected() != 1 {
			return domain.Fail("STATE_CONFLICT", "Specimen identity, sequence or barcode cannot change")
		}
		var prior string
		e = t.tx.QueryRow(ctx, `INSERT INTO specimen_barcodes(barcode,order_id)VALUES($1,$2)ON CONFLICT(barcode)DO UPDATE SET barcode=EXCLUDED.barcode RETURNING order_id::text`, s.Barcode, o.ID).Scan(&prior)
		if e != nil {
			return e
		}
		if prior != o.ID {
			return domain.Fail("STATE_CONFLICT", "Barcode already in use")
		}
	}
	return nil
}
func (t diagnosticTx) Outbox(ctx context.Context, m domain.Envelope, exchange, key string) error {
	b, e := json.Marshal(m)
	if e != nil {
		return e
	}
	_, e = t.tx.Exec(ctx, `INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope)VALUES($1,$2,$3,$4,$5)`, m.MessageID, m.AggregateID, exchange, key, b)
	return e
}
func (t diagnosticTx) SeenMessage(ctx context.Context, id, hash, leaseID string) (seen bool, e error) {
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
func (t diagnosticTx) MarkMessage(ctx context.Context, id, hash string) error {
	_, e := t.tx.Exec(ctx, `INSERT INTO inbox(message_id,payload_hash)VALUES($1,$2) ON CONFLICT(message_id)DO UPDATE SET status='PROCESSED',processed_at=now() WHERE inbox.payload_hash=EXCLUDED.payload_hash`, id, hash)
	return e
}
