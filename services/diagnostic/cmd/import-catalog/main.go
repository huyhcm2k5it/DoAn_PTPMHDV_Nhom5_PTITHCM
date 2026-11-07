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
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := postgres.New(ctx, os.Getenv("DATABASE_URL"))
	if err == nil {
		defer db.Close()
		err = db.BusinessReady(ctx)
	}
	var snapshot postgres.CatalogSnapshotImport
	if err == nil {
		decoder := json.NewDecoder(io.LimitReader(os.Stdin, 8<<20))
		decoder.DisallowUnknownFields()
		err = decoder.Decode(&snapshot)
		if err == nil {
			var extra any
			if next := decoder.Decode(&extra); next != io.EOF {
				if next == nil {
					next = io.ErrUnexpectedEOF
				}
				err = next
			}
		}
	}
	if err == nil {
		err = db.ImportCatalogSnapshot(ctx, snapshot)
	}
	if err != nil {
		slog.Error("Trusted Catalog snapshot import failed")
		os.Exit(1)
	}
	slog.Info("Trusted Catalog snapshot import committed", "watermark", snapshot.Watermark)
}
