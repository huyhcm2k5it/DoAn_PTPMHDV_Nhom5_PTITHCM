package postgres

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"umccare/clinical/internal/domain"
)

// A current, unrevoked care relationship permits signed history reads. A
// historical signed visit alone never grants access to the whole patient file.
func (t clinicalTx) AuthorizePatientHistory(ctx context.Context, doctor, patient string) error {
	var visit string
	err := t.tx.QueryRow(ctx, `SELECT v.id::text FROM visits v
		JOIN visit_doctor_grants g ON g.visit_id=v.id
		WHERE v.patient_id=$1 AND v.doctor_user_id=$2 AND v.state<>'SIGNED' AND g.active
		ORDER BY v.id LIMIT 1 FOR SHARE OF v,g`, patient, doctor).Scan(&visit)
	if err == nil {
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var missing bool
	err = t.tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM visits v
		LEFT JOIN visit_doctor_grants g ON g.visit_id=v.id
		WHERE v.patient_id=$1 AND v.doctor_user_id=$2 AND v.state<>'SIGNED' AND g.visit_id IS NULL)`, patient, doctor).Scan(&missing)
	if err != nil {
		return err
	}
	if missing {
		return domain.Fail("SERVICE_UNAVAILABLE", "Current visit grant is missing")
	}
	return domain.Fail("NOT_FOUND", "Patient records not found")
}

func (t clinicalTx) PatientRecords(ctx context.Context, patientID string, page, limit int) (out domain.MedicalRecords, err error) {
	out.Items = []domain.MedicalRecord{}
	if err = t.tx.QueryRow(ctx, `SELECT count(*) FROM visits WHERE patient_id=$1 AND state='SIGNED'`, patientID).Scan(&out.Total); err != nil {
		return
	}
	rows, err := t.tx.Query(ctx, `SELECT `+visitColumns+` FROM visits WHERE patient_id=$1 AND state='SIGNED' ORDER BY signed_at DESC,id LIMIT $2 OFFSET $3`, patientID, limit, (page-1)*limit)
	if err != nil {
		return out, err
	}
	var visits []domain.Visit
	for rows.Next() {
		v, e := scanVisit(rows)
		if e != nil {
			rows.Close()
			return out, e
		}
		visits = append(visits, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	for _, visit := range visits {
		record := domain.MedicalRecord{Visit: visit, Prescriptions: []domain.Prescription{}, PublishedLabResults: []domain.PublishedLabResultReference{}}
		// Only the latest note that existed at signing belongs to the signed record.
		err = t.tx.QueryRow(ctx, `SELECT id::text,visit_id::text,revision,symptoms,findings,assessment,diagnosis,author_user_id::text,saved_at FROM visit_notes WHERE visit_id=$1 AND saved_at<=$2 ORDER BY revision DESC LIMIT 1`, visit.ID, visit.SignedAt).Scan(&record.Note.ID, &record.Note.VisitID, &record.Note.Revision, &record.Note.Symptoms, &record.Note.Findings, &record.Note.Assessment, &record.Note.Diagnosis, &record.Note.AuthorUserID, &record.Note.SavedAt)
		if err != nil {
			return out, err
		}
		prescriptions, e := t.Prescriptions(ctx, visit.ID)
		if e != nil {
			return out, e
		}
		for _, prescription := range prescriptions {
			if prescription.State == "FINAL" {
				record.Prescriptions = append(record.Prescriptions, prescription)
			}
		}
		refs, e := t.tx.Query(ctx, `SELECT order_id::text,revision,published_at FROM lab_terminal_projection WHERE visit_id=$1 AND state='PUBLISHED' ORDER BY published_at,order_id`, visit.ID)
		if e != nil {
			return out, e
		}
		for refs.Next() {
			var ref domain.PublishedLabResultReference
			if e = refs.Scan(&ref.OrderID, &ref.Revision, &ref.PublishedAt); e != nil {
				refs.Close()
				return out, e
			}
			record.PublishedLabResults = append(record.PublishedLabResults, ref)
		}
		e = refs.Err()
		refs.Close()
		if e != nil {
			return out, e
		}
		out.Items = append(out.Items, record)
	}
	return out, nil
}
