//go:build integration

package postgres

import (
	"context"
	"testing"
	"time"

	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

func TestVisitSubjectsPreserveExistingOrdersAndRejectConflicts(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	original := domain.Order{ID: domain.NewID(), RequestID: domain.NewID(), VisitID: domain.NewID(), PatientID: domain.NewID(), State: "PAID", Version: 3, SourceRevision: 1, AmountVND: 50000, CreatedAt: time.Now().UTC()}
	if err := db.Within(ctx, "diagnostic:business", func(tx ports.Tx) error { return tx.SaveOrder(ctx, original) }); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.pool.QueryRow(ctx, `SELECT count(*) FROM diagnostic_visit_subjects WHERE visit_id=$1 AND patient_id=$2`, original.VisitID, original.PatientID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("legacy mapping not preserved: count=%d error=%v", n, err)
	}
	if err := db.Within(ctx, "diagnostic:business", func(tx ports.Tx) error {
		orders, err := tx.Orders(ctx)
		if err != nil {
			return err
		}
		if len(orders) != 1 || orders[0].PatientID != original.PatientID || orders[0].VisitID != original.VisitID || orders[0].AmountVND != original.AmountVND || orders[0].Version != 3 {
			t.Fatal("legacy order no longer has its original public and billing data")
		}
		second := original
		second.ID, second.RequestID = domain.NewID(), domain.NewID()
		return tx.SaveOrder(ctx, second)
	}); err != nil {
		t.Fatal(err)
	}
	err := db.Within(ctx, "diagnostic:business", func(tx ports.Tx) error {
		conflict := original
		conflict.ID, conflict.RequestID, conflict.PatientID = domain.NewID(), domain.NewID(), domain.NewID()
		return tx.SaveOrder(ctx, conflict)
	})
	if domain.Code(err) != "STATE_CONFLICT" {
		t.Fatalf("same visit assigned to a different patient: %v", err)
	}
	if err := db.pool.QueryRow(ctx, `SELECT count(*) FROM lab_orders WHERE visit_id=$1`, original.VisitID).Scan(&n); err != nil || n != 2 {
		t.Fatalf("orders not normalized: count=%d error=%v", n, err)
	}
}
