// rebind-doctor repairs owner-verified mappings; it is not a public HTTP API.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"
	"umccare/catalog/internal/adapters/outbound/postgres"
	"umccare/catalog/internal/domain"
)

func main() {
	var c postgres.DoctorMappingChange
	flag.StringVar(&c.DoctorID, "doctor-id", "", "Catalog doctor UUID")
	flag.StringVar(&c.ExpectedIdentityUserID, "expected-user-id", "", "Current Identity UUID verified by owner")
	flag.StringVar(&c.IdentityUserID, "identity-user-id", "", "Replacement Identity DOCTOR UUID")
	flag.StringVar(&c.Operator, "operator", "", "Operator label for audit")
	flag.StringVar(&c.Reason, "reason", "", "Owner-verified repair reason")
	apply := flag.Bool("apply", false, "Commit mapping, audit and CatalogChanged outbox atomically")
	flag.Parse()
	if !*apply || os.Getenv("DATABASE_URL") == "" {
		fmt.Fprintln(os.Stderr, "Supply Catalog DATABASE_URL, reviewed mapping flags and -apply")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := postgres.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "Catalog database unavailable")
		os.Exit(1)
	}
	defer db.Close()
	if err = db.Ready(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "Run Catalog migrations first")
		os.Exit(1)
	}
	result, err := db.RebindDoctor(ctx, c)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Mapping repair failed:", domain.Code(err))
		os.Exit(1)
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
}
