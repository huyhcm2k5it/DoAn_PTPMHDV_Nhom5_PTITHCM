package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"time"
	"umccare/clinical/internal/adapters/outbound/postgres"
)

func main() {
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		slog.Error("DATABASE_URL required")
		os.Exit(1)
	}
	db, e := postgres.New(ctx, dsn)
	if e != nil {
		slog.Error("Clinical database configuration invalid")
		os.Exit(1)
	}
	defer db.Close()
	e = db.Migrate(ctx)
	if e != nil {
		slog.Error("Clinical migration failed")
		os.Exit(1)
	}
	slog.Info("Clinical migration completed; no demo data inserted")
}
