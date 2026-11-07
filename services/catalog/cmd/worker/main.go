package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	amqpadapter "umccare/catalog/internal/adapters/inbound/amqp"
	"umccare/catalog/internal/adapters/outbound/postgres"
	"umccare/catalog/internal/application/usecase"
)

func main() {
	if err := run(); err != nil {
		slog.Error("Catalog worker stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	broker := os.Getenv("AMQP_URL")
	if broker == "" {
		return fmt.Errorf("AMQP_URL is required")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	db, err := postgres.New(startup, dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	if err = db.Migrate(startup); err != nil {
		return err
	}
	declare := strings.EqualFold(os.Getenv("CATALOG_DECLARE_TOPOLOGY"), "true")
	slog.Info("Catalog stream worker starting", "topologyDeclaration", declare)
	return amqpadapter.Run(ctx, broker, db, usecase.NewStream(db), declare)
}
