package main

import (
	"context"
	"log/slog"
	"os"
	"time"
	"umccare/diagnostic/internal/adapters/outbound/postgres"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		slog.Error("DATABASE_URL required")
		os.Exit(1)
	}
	db, e := postgres.New(ctx, dsn)
	if e != nil {
		slog.Error("Diagnostic database configuration invalid")
		os.Exit(1)
	}
	defer db.Close()
	e = db.Migrate(ctx)
	if e != nil {
		slog.Error("Diagnostic migration/seed failed")
		os.Exit(1)
	}
	slog.Info("Diagnostic migration completed")
}
