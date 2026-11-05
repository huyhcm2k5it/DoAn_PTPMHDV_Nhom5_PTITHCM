package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"time"
	"umccare/diagnostic/internal/adapters/outbound/postgres"
)

func main() {
	if run() != nil {
		slog.Error("Trusted Diagnostic projection import failed; verify input, revisions and database")
		os.Exit(1)
	}
}
func run() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, e := postgres.New(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		return e
	}
	defer db.Close()
	if e = db.BusinessReady(ctx); e != nil {
		return e
	}
	d := json.NewDecoder(io.LimitReader(os.Stdin, 8<<20))
	d.DisallowUnknownFields()
	var items []postgres.ProjectionImport
	if e = d.Decode(&items); e != nil {
		return e
	}
	var extra any
	if e = d.Decode(&extra); e != io.EOF {
		if e == nil {
			return io.ErrUnexpectedEOF
		}
		return e
	}
	return db.ImportProjections(ctx, items)
}
