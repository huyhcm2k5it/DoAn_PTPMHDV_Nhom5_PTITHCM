package postgres

import (
	"context"
	"time"
	"umccare/diagnostic/internal/application/projection"
)

func (t diagnosticTx) RecordsCacheVersion(ctx context.Context, patient, doctor string, now time.Time) (string, error) {
	// A cache hit must not bypass the grant stream's freshness/gap guard.
	if doctor != "" {
		if err := projection.RequireCurrentVisitStream(ctx, t, now); err != nil {
			return "", err
		}
	}
	var version string
	err := t.tx.QueryRow(ctx, `SELECT md5(jsonb_build_array(
        (SELECT jsonb_agg(jsonb_build_array(r.id,r.version,r.published_at) ORDER BY r.id)
            FROM results r JOIN lab_orders o ON o.id=r.order_id
            JOIN diagnostic_visit_subjects s ON s.visit_id=o.visit_id
            WHERE s.patient_id=$1 AND r.state='PUBLISHED'),
        (SELECT jsonb_agg(jsonb_build_array(g.key,g.value) ORDER BY g.key)
            FROM objects g WHERE $2<>'' AND g.kind='visit_grant' AND g.value->>'patientId'=$1::text)
    )::text)`, patient, doctor).Scan(&version)
	return version, err
}
