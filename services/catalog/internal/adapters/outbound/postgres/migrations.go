package postgres

import (
	"context"
	"fmt"

	"umccare/catalog/internal/domain"
	"umccare/catalog/migrations"
)

var catalogMigrations = [...]struct {
	version int32
	file    string
}{
	{1, "000001_catalog.up.sql"},
	{2, "000002_catalog_stream.up.sql"},
	{3, "000003_doctor_mapping.up.sql"},
	{4, "000004_catalog_erd_alignment.up.sql"},
	{5, "000005_broker_delivery.up.sql"},
	{6, "000006_outbox_stream_order.up.sql"},
}

func (s *Store) Ready(ctx context.Context) error {
	versions := make([]int32, len(catalogMigrations))
	for i, migration := range catalogMigrations {
		versions[i] = migration.version
	}
	var ready bool
	if err := s.pool.QueryRow(ctx, "SELECT count(*)=cardinality($1::integer[]) FROM schema_migrations WHERE version=ANY($1::integer[])", versions).Scan(&ready); err != nil {
		return err
	}
	if !ready {
		return domain.Fail("SERVICE_UNAVAILABLE", "Catalog schema migrations are required")
	}
	return nil
}

func (s *Store) Migrate(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(74001001)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		return err
	}
	for _, migration := range catalogMigrations {
		var exists bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", migration.version).Scan(&exists); err != nil {
			return fmt.Errorf("check Catalog migration %d: %w", migration.version, err)
		}
		if exists {
			continue
		}
		sql, readErr := migrations.Files.ReadFile(migration.file)
		if readErr != nil {
			return fmt.Errorf("read Catalog migration %d: %w", migration.version, readErr)
		}
		if _, err = tx.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("apply Catalog migration %d: %w", migration.version, err)
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations(version) VALUES($1)", migration.version); err != nil {
			return fmt.Errorf("record Catalog migration %d: %w", migration.version, err)
		}
	}
	return tx.Commit(ctx)
}
