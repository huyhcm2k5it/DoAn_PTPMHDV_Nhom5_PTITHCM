package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"umccare/catalog/internal/adapters/outbound/postgres"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is required")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := postgres.New(ctx, dsn)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Catalog database unavailable")
		os.Exit(1)
	}
	defer db.Close()
	snapshot, err := db.ExportCatalogSnapshot(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Catalog snapshot export failed")
		os.Exit(1)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err = encoder.Encode(snapshot); err != nil {
		fmt.Fprintln(os.Stderr, "Could not write snapshot")
		os.Exit(1)
	}
}
