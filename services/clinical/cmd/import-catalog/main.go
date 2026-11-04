package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"io"
	"log/slog"
	"os"
	"time"
	"umccare/clinical/internal/adapters/outbound/postgres"
)

func main() {
	file := flag.String("file", "", "trusted Catalog export JSON array, operator only")
	flag.Parse()
	run := func() error {
		raw, e := os.ReadFile(*file)
		if e != nil {
			return e
		}
		if len(raw) > 4<<20 {
			return io.ErrShortBuffer
		}
		var entries []postgres.CatalogImport
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if e = decoder.Decode(&entries); e != nil {
			return e
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			return io.ErrUnexpectedEOF
		}
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
		return db.ImportCatalog(ctx, entries)
	}
	if e := run(); e != nil {
		slog.Error("Trusted catalog import failed")
		os.Exit(1)
	}
	slog.Info("Trusted catalog import committed")
}
