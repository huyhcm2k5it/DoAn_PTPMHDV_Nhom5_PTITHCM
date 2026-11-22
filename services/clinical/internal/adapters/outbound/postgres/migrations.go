package postgres

import (
	"context"
	"fmt"

	"umccare/clinical/internal/domain"
	"umccare/clinical/migrations"
)

var clinicalMigrations = [...]string{
	"000001_clinical",
	"000002_treatment",
	"000003_catalog_stream",
	"000004_lab_terminal",
	"000005_lab_resubmit",
	"000006_visit_grants",
	"000007_treatment_normalization",
	"000008_broker_delivery",
}

func (p *Probe) Migrate(ctx context.Context) error {
	tx, e := p.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('clinical:migrate',0)); CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`); e != nil {
		return e
	}
	for _, version := range clinicalMigrations {
		var applied bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)`, version).Scan(&applied); err != nil {
			return fmt.Errorf("check Clinical migration %s: %w", version, err)
		}
		if applied {
			continue
		}
		sql, err := migrations.Files.ReadFile(version + ".up.sql")
		if err != nil {
			return fmt.Errorf("read Clinical migration %s: %w", version, err)
		}
		if _, err = tx.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("apply Clinical migration %s: %w", version, err)
		}
		if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version) VALUES($1)`, version); err != nil {
			return fmt.Errorf("record Clinical migration %s: %w", version, err)
		}
	}
	return tx.Commit(ctx)
}

func (p *Probe) BusinessReady(ctx context.Context) error {
	var ok bool
	if e := p.pool.QueryRow(ctx, `SELECT count(*)=cardinality($1::text[]) FROM schema_migrations WHERE version=ANY($1::text[])`, clinicalMigrations[:]).Scan(&ok); e != nil || !ok {
		return domain.Fail("SERVICE_UNAVAILABLE", "Clinical migrations are required")
	}
	return nil
}
