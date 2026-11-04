package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
	amqpadapter "umccare/diagnostic/internal/adapters/inbound/amqp"
	"umccare/diagnostic/internal/adapters/outbound/postgres"
	"umccare/diagnostic/internal/application/usecase"
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
		slog.Error("Diagnostic database configuration invalid")
		os.Exit(1)
	}
	defer db.Close()
	if e = db.BusinessReady(ctx); e != nil {
		slog.Error("Diagnostic migrations required before worker")
		os.Exit(1)
	}
	service := usecase.New(db, time.Now)
	receiver := usecase.NewReceiver(service, db)
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if e := service.Reconcile(ctx); e != nil && ctx.Err() == nil {
					slog.Warn("Diagnostic settlement reconciliation deferred")
				}
			}
		}
	}()
	for ctx.Err() == nil {
		if e = amqpadapter.Run(ctx, url, db, receiver, os.Getenv("DIAGNOSTIC_DECLARE_TOPOLOGY") == "1"); e != nil && ctx.Err() == nil {
			slog.Warn("Diagnostic worker disconnected; unacknowledged deliveries remain pending")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}
