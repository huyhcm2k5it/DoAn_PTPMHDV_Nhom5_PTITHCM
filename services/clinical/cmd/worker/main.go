package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
	amqpadapter "umccare/clinical/internal/adapters/inbound/amqp"
	"umccare/clinical/internal/adapters/outbound/postgres"
	"umccare/clinical/internal/application/usecase"
)

func main() {
	dsn, url := os.Getenv("DATABASE_URL"), os.Getenv("RABBITMQ_URL")
	if dsn == "" || url == "" {
		slog.Error("DATABASE_URL and RABBITMQ_URL required")
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, e := postgres.New(ctx, dsn)
	if e != nil {
		slog.Error("Clinical database configuration invalid")
		os.Exit(1)
	}
	defer db.Close()
	if e = db.BusinessReady(ctx); e != nil {
		slog.Error("Clinical migrations required before worker")
		os.Exit(1)
	}
	receiver := usecase.NewReceiver(usecase.New(db, time.Now), db)
	for ctx.Err() == nil {
		if e = amqpadapter.Run(ctx, url, db, receiver, os.Getenv("CLINICAL_DECLARE_TOPOLOGY") == "1"); e != nil && ctx.Err() == nil {
			slog.Warn("Clinical worker disconnected; unacknowledged deliveries remain pending")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}
