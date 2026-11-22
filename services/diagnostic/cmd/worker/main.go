package main

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgconn"
	amqp "github.com/rabbitmq/amqp091-go"
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
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				call, cancel := context.WithTimeout(ctx, 10*time.Second)
				e := service.Reconcile(call)
				cancel()
				if e != nil && ctx.Err() == nil {
					slog.Warn("Diagnostic settlement reconciliation deferred")
				}
			}
		}
	}()
	for ctx.Err() == nil {
		if e = amqpadapter.Run(ctx, url, db, receiver, os.Getenv("DIAGNOSTIC_DECLARE_TOPOLOGY") == "1"); e != nil && ctx.Err() == nil {
			var databaseError *pgconn.PgError
			var brokerError *amqp.Error
			switch {
			case errors.As(e, &databaseError):
				slog.Warn("Diagnostic worker database failure; delivery retained", "sqlState", databaseError.Code, "constraint", databaseError.ConstraintName, "column", databaseError.ColumnName)
			case errors.As(e, &brokerError):
				slog.Warn("Diagnostic worker broker failure; delivery retained", "brokerCode", brokerError.Code, "reason", brokerError.Reason)
			default:
				slog.Warn("Diagnostic worker disconnected; unacknowledged deliveries remain pending", "errorType", fmt.Sprintf("%T", e))
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}
