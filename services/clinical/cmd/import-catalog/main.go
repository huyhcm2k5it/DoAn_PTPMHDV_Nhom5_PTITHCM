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
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if len(bytes.TrimSpace(raw)) > 0 && bytes.TrimSpace(raw)[0] == '[' {
			var entries []postgres.CatalogImport
			if e = decoder.Decode(&entries); e != nil {
				return e
			}
			var extra any
			if decoder.Decode(&extra) != io.EOF {
				return io.ErrUnexpectedEOF
			}
			return db.ImportCatalog(ctx, entries)
		}
		var snapshot postgres.CatalogSnapshotImport
		if e = decoder.Decode(&snapshot); e != nil {
			return e
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			return io.ErrUnexpectedEOF
		}
		return db.ImportCatalogSnapshot(ctx, snapshot)
	}
	if e := run(); e != nil {
		slog.Error("Trusted catalog import failed")
		os.Exit(1)
	}
	slog.Info("Trusted catalog import committed")
}
