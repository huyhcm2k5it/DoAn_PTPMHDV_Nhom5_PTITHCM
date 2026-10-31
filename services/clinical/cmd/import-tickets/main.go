package main

import (
	"context"
	"encoding/json"
	"flag"
	"log/slog"
	"os"
	"time"
	"umccare/clinical/internal/adapters/outbound/postgres"
	"umccare/clinical/internal/domain"
)

func main() {
	file := flag.String("file", "", "trusted Appointment snapshot JSON array; operator-only")
	flag.Parse()
	if *file == "" || os.Getenv("DATABASE_URL") == "" {
		slog.Error("-file and DATABASE_URL required")
		os.Exit(1)
	}
	b, e := os.ReadFile(*file)
	if e != nil || len(b) > 1<<20 {
		slog.Error("Cannot read bounded ticket snapshot")
		os.Exit(1)
	}
	var tickets []domain.Ticket
	if json.Unmarshal(b, &tickets) != nil || len(tickets) > 1000 {
		slog.Error("Invalid ticket snapshot array")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, e := postgres.New(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		slog.Error("Database configuration invalid")
		os.Exit(1)
	}
	defer db.Close()
	if e = db.ImportTickets(ctx, tickets); e != nil {
		slog.Error("Ticket snapshot import rejected")
		os.Exit(1)
	}
	slog.Info("Trusted Appointment tickets imported", "count", len(tickets))
}
