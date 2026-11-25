package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"
	"umccare/catalog/internal/adapters/outbound/postgres"
)

func main() {
	flag.Parse()
	if os.Getenv("DATABASE_URL") == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is required")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, e := postgres.New(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		fmt.Fprintln(os.Stderr, "Database configuration failed")
		os.Exit(1)
	}
	defer db.Close()
	if e = db.Migrate(ctx); e != nil {
		fmt.Fprintln(os.Stderr, "Catalog migration failed")
		os.Exit(1)
	}
	fmt.Println("Catalog schema ready; business data is managed in the configured database")
}
