package postgres

import (
	"context"
	"time"
)

func (t clinicalTx) RecordsCacheVersion(ctx context.Context, patient, doctor string, now time.Time) (string, error) {
	var version string
	err := t.tx.QueryRow(ctx, `SELECT md5(jsonb_build_array(
        (SELECT jsonb_agg(jsonb_build_array(v.id,v.version,v.signed_at) ORDER BY v.id)
            FROM visits v WHERE v.patient_id=$1 AND v.state='SIGNED'),
        (SELECT jsonb_agg(jsonb_build_array(p.id,p.version,p.revision) ORDER BY p.id)
            FROM prescriptions p JOIN visits v ON v.id=p.visit_id
            WHERE v.patient_id=$1 AND v.state='SIGNED' AND p.state='FINAL'),
        (SELECT jsonb_agg(jsonb_build_array(n.id,n.revision,n.saved_at) ORDER BY n.id)
            FROM visit_notes n JOIN visits v ON v.id=n.visit_id
            WHERE v.patient_id=$1 AND v.state='SIGNED' AND n.saved_at<=v.signed_at),
        (SELECT jsonb_agg(jsonb_build_array(l.order_id,l.semantic_hash) ORDER BY l.order_id)
            FROM lab_terminal_projection l JOIN visits v ON v.id=l.visit_id WHERE v.patient_id=$1 AND v.state='SIGNED')
    )::text)`, patient).Scan(&version)
	return version, err
}
