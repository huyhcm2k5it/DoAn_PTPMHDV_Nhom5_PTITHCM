package main

import (
	"context"
	"flag"
	"log"
	"os"
	"time"

	"umccare/clinical/internal/adapters/outbound/postgres"
	"umccare/clinical/internal/domain"
)

func main() {
	visit := flag.String("visit-id", "", "owner-verified Clinical visit UUID")
	revoke := flag.Bool("revoke", false, "revoke the assigned doctor's access")
	apply := flag.Bool("apply", false, "write the grant and outbox event")
	flag.Parse()
	if !domain.ValidID(*visit) || !*apply || os.Getenv("DATABASE_URL") == "" {
		log.Fatal("supply DATABASE_URL, -visit-id and -apply")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := postgres.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal("Clinical database configuration is unavailable")
	}
	defer db.Close()
	if err = db.BusinessReady(ctx); err != nil {
		log.Fatal("Clinical migrations are required")
	}
	if err = db.ReconcileVisitGrant(ctx, domain.ID(*visit), *revoke, time.Now()); err != nil {
		log.Fatal("Visit grant was not queued")
	}
	log.Print("Visit grant queued in the Clinical outbox")
}
