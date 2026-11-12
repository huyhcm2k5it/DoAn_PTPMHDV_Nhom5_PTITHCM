//go:build integration

package postgres

import (
	"context"
	"testing"
	"time"

	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/application/projection"
	"umccare/diagnostic/internal/domain"
)

func TestDoctorResultsFilterBeforePaginationAndHonorRevocation(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	patient, doctor := domain.NewID(), domain.NewID()
	var own, ownVisit string
	err := db.Within(ctx, "diagnostic:business", func(raw ports.Tx) error {
		tx := raw.(diagnosticTx)
		active, canCancel := true, false
		for i, assigned := range []string{doctor, domain.NewID()} {
			visit, order, result := domain.NewID(), domain.NewID(), domain.NewID()
			if i == 0 {
				own, ownVisit = result, visit
			}
			grant := projection.VisitGrantEvent{Mode: "UPSERT", Sequence: i + 1, VisitID: visit, PatientID: patient, DoctorUserID: assigned, Active: &active, CanCancel: &canCancel}
			if _, err := projection.ApplyVisitGrant(ctx, tx, domain.Envelope{AggregateID: visit, AggregateVersion: i + 1, OccurredAt: now}, grant, now); err != nil {
				return err
			}
			if err := tx.SaveOrder(ctx, domain.Order{ID: order, RequestID: domain.NewID(), VisitID: visit, PatientID: patient, State: "PUBLISHED"}); err != nil {
				return err
			}
			at := now.Add(time.Duration(i) * time.Second)
			if err := tx.Put(ctx, "result-order", order, result); err != nil {
				return err
			}
			if err := tx.Put(ctx, "result", result, map[string]any{"result": domain.Result{ID: result, OrderID: order, State: "PUBLISHED", PublishedAt: &at}}); err != nil {
				return err
			}
		}
		checkpoint := projection.VisitGrantEvent{Mode: "CHECKPOINT", Sequence: 3}
		if _, err := projection.ApplyVisitGrant(ctx, tx, domain.Envelope{AggregateID: projection.VisitGrantStreamID, AggregateVersion: 3, OccurredAt: now}, checkpoint, now); err != nil {
			return err
		}
		out, err := tx.PublishedResultsForDoctor(ctx, patient, doctor, 1, 1, now)
		if err != nil || out.Total != 1 || len(out.Items) != 1 || out.Items[0].ID != own {
			t.Fatalf("incorrect doctor-filtered page: %+v, %v", out, err)
		}
		if err = tx.VerifyVisitGrant(ctx, ownVisit, patient, doctor, true, now); domain.Code(err) != "STATE_CONFLICT" {
			t.Fatalf("signed visit permitted cancellation: %v", err)
		}
		active = false
		revoked := projection.VisitGrantEvent{Mode: "UPSERT", Sequence: 4, VisitID: ownVisit, PatientID: patient, DoctorUserID: doctor, Active: &active, CanCancel: &canCancel}
		if _, err = projection.ApplyVisitGrant(ctx, tx, domain.Envelope{AggregateID: ownVisit, AggregateVersion: 4, OccurredAt: now}, revoked, now); err != nil {
			return err
		}
		out, err = tx.PublishedResultsForDoctor(ctx, patient, doctor, 1, 1, now)
		if err != nil || out.Total != 0 || len(out.Items) != 0 {
			t.Fatalf("revoked result remained visible: %+v, %v", out, err)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
