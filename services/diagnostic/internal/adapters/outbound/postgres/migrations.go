package postgres

import (
	"context"
	"fmt"

	"umccare/diagnostic/internal/domain"
	"umccare/diagnostic/migrations"
)

var diagnosticMigrations = [...]string{
	"000001_diagnostic",
	"000002_visit_subjects",
	"000003_diagnostic_erd_alignment",
	"000004_broker_delivery",
}

func (p *Probe) Migrate(ctx context.Context) error {
	tx, e := p.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('diagnostic:migrate',0));CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY)`); e != nil {
		return e
	}
	for _, version := range diagnosticMigrations {
		var exists bool
		if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)`, version).Scan(&exists); e != nil {
			return fmt.Errorf("check Diagnostic migration %s: %w", version, e)
		}
		if exists {
			continue
		}
		b, readErr := migrations.Files.ReadFile(version + ".up.sql")
		if readErr != nil {
			return fmt.Errorf("read Diagnostic migration %s: %w", version, readErr)
		}
		if _, e = tx.Exec(ctx, string(b)); e != nil {
			return fmt.Errorf("apply Diagnostic migration %s: %w", version, e)
		}
		if _, e = tx.Exec(ctx, `INSERT INTO schema_migrations VALUES($1)`, version); e != nil {
			return fmt.Errorf("record Diagnostic migration %s: %w", version, e)
		}
	}
	return tx.Commit(ctx)
}

func (p *Probe) BusinessReady(ctx context.Context) error {
	var b bool
	e := p.pool.QueryRow(ctx, `SELECT count(*)=cardinality($1::text[]) FROM schema_migrations WHERE version=ANY($1::text[])`, diagnosticMigrations[:]).Scan(&b)
	if e != nil || !b {
		return domain.Fail("SERVICE_UNAVAILABLE", "Diagnostic migrations required")
	}
	return nil
}
