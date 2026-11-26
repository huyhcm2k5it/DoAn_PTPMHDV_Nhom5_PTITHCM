//go:build integration

package postgres

import (
	"context"
	"embed"
	"fmt"
)

// Only integration tests embed fictional fixtures; production binaries cannot seed them.
//
//go:embed testdata/catalog.sql
var catalogTestFiles embed.FS

func (s *Store) Seed(ctx context.Context) error {
	sql, err := catalogTestFiles.ReadFile("testdata/catalog.sql")
	if err != nil {
		return fmt.Errorf("read Catalog seed: %w", err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, string(sql)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
