package main

import (
	"context"
	"flag"
	"log/slog"
	"net/url"
	"os"
	"time"
	"umccare/clinical/internal/adapters/outbound/postgres"
)

func main() {
	seed := flag.Bool("seed-demo", false, "opt-in local fake access/ticket fixtures; never creates accepted claims")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		slog.Error("DATABASE_URL required")
		os.Exit(1)
	}
	if *seed {
		u, e := url.Parse(dsn)
		if e != nil || os.Getenv("CLINICAL_ALLOW_DEMO_SEED") != "1" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1") {
			slog.Error("demo seed requires CLINICAL_ALLOW_DEMO_SEED=1 and loopback database URL")
			os.Exit(1)
		}
	}
	db, e := postgres.New(ctx, dsn)
	if e != nil {
		slog.Error("Clinical database configuration invalid")
		os.Exit(1)
	}
	defer db.Close()
	if e = db.Migrate(ctx); e == nil && *seed {
		e = db.SeedDemo(ctx)
	}
	if e != nil {
		slog.Error("Clinical migration/seed failed")
		os.Exit(1)
	}
	slog.Info("Clinical migration completed", "demoSeed", *seed)
}
