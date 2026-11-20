//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

func TestGroupDiagnosticDataRoundTrip(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	raw, err := os.ReadFile("../../../../../../docs/umc-care-demo-data.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Services struct {
			Diagnostic map[string]json.RawMessage
			Clinical   struct {
				Visits []struct {
					DoctorUserID string `json:"doctor_user_id"`
				}
			}
		}
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	data := fixture.Services.Diagnostic
	var source []struct {
		ID              string
		VisitID         string `json:"visit_id"`
		RequestID       string `json:"clinical_request_id"`
		State           string
		Version         int
		ChargeID        string                `json:"charge_id"`
		CreatedAt       time.Time             `json:"created_at"`
		Tests           []domain.TestSnapshot `json:"test_snapshot"`
		Prices          []domain.PriceLine    `json:"price_snapshot"`
		SettlementID    string                `json:"settlement_id"`
		SettlementState string                `json:"settlement_state"`
		Fence           int                   `json:"settlement_version"`
	}
	if err = json.Unmarshal(data["lab_orders"], &source); err != nil || len(source) != 1 {
		t.Fatalf("order fixture: %v", err)
	}
	var subjects []struct {
		PatientID string `json:"patient_id"`
	}
	if err = json.Unmarshal(data["diagnostic_visit_subjects"], &subjects); err != nil || len(subjects) != 1 || len(fixture.Services.Clinical.Visits) != 1 {
		t.Fatalf("visit subject fixture: %v", err)
	}
	src := source[0]
	order := domain.Order{
		ID: src.ID, VisitID: src.VisitID, RequestID: src.RequestID,
		PatientID: subjects[0].PatientID, DoctorID: fixture.Services.Clinical.Visits[0].DoctorUserID,
		State: src.State, Version: src.Version, CreatedAt: src.CreatedAt,
		Tests: src.Tests, Lines: src.Prices, SourceRevision: 1,
		ChargeID: src.ChargeID, ChargeState: "PAID",
		SettlementID: src.SettlementID, SettlementState: src.SettlementState, Fence: src.Fence,
		RequestHash: "isolated-storage-fixture", LastQueryAt: time.Unix(0, 0),
	}
	for _, price := range order.Lines {
		order.AmountVND += int64(price.Quantity) * price.UnitPriceVND
	}
	order.AmountHash = domain.Hash(order.Lines)
	if err = db.Within(ctx, "", func(tx ports.Tx) error { return tx.SaveOrder(ctx, order) }); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"specimens", "results", "result_contributors"} {
		if _, err = db.pool.Exec(ctx, "INSERT INTO "+table+" SELECT * FROM jsonb_populate_recordset(NULL::"+table+",$1::jsonb)", data[table]); err != nil {
			t.Fatalf("%s: %v", table, err)
		}
	}
	if _, err = db.pool.Exec(ctx, `INSERT INTO result_items
		SELECT (jsonb_populate_record(NULL::result_items,item || jsonb_build_object('position',position-1))).*
		FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS source(item,position)`, data["result_items"]); err != nil {
		t.Fatal(err)
	}
	if err = db.Within(ctx, "", func(tx ports.Tx) error {
		stored, err := tx.Order(ctx, order.ID)
		if err != nil {
			return err
		}
		if stored.PatientID != order.PatientID || stored.AmountVND != 100000 || len(stored.Specimens) != 1 || stored.Specimens[0].Barcode != "BARCODE-001" {
			t.Fatalf("order changed after save/read: %+v", stored)
		}
		published, err := tx.(ports.PublishedResultsRecords).PublishedResultsForPatient(ctx, order.PatientID, 1, 10)
		if err != nil {
			return err
		}
		if published.Total != 1 || len(published.Items) != 1 || len(published.Items[0].Items) != 1 {
			t.Fatalf("published results: %+v", published)
		}
		item := published.Items[0].Items[0]
		if item.TestCode != "LAB-01" || item.Unit != order.Tests[0].Unit || item.ReferenceRange != order.Tests[0].ReferenceRange || item.ValueText != "Giá trị mẫu" {
			t.Fatalf("result snapshot changed: %+v", item)
		}
		hidden, err := tx.(ports.PublishedResultsRecords).PublishedResultsForPatient(ctx, domain.NewID(), 1, 10)
		if err == nil && (hidden.Total != 0 || len(hidden.Items) != 0) {
			t.Fatalf("result leaked to unrelated patient: %+v", hidden)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}

	// Reading one order must not wait on an unrelated order row.
	first, err := db.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Rollback(ctx)
	if _, err = first.Exec(ctx, "SELECT id FROM lab_orders WHERE id=$1 FOR UPDATE", order.ID); err != nil {
		t.Fatal(err)
	}
	second := order
	second.ID, second.RequestID, second.VisitID = domain.NewID(), domain.NewID(), domain.NewID()
	second.Specimens = nil
	if err = db.Within(ctx, "", func(tx ports.Tx) error { return tx.SaveOrder(ctx, second) }); err != nil {
		t.Fatal(err)
	}
	lockCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err = db.Within(lockCtx, "", func(tx ports.Tx) error {
		_, err := tx.Order(lockCtx, second.ID)
		return err
	}); err != nil {
		t.Fatal("unrelated order lock blocked the lookup", err)
	}
	if err = db.Within(lockCtx, "", func(tx ports.Tx) error {
		firstPage, err := tx.OrderPage(lockCtx, domain.Query{State: "PUBLISHED", Page: 1, Limit: 1})
		if err != nil {
			return err
		}
		secondPage, err := tx.OrderPage(lockCtx, domain.Query{State: "PUBLISHED", Page: 2, Limit: 1})
		if err != nil {
			return err
		}
		beyond, err := tx.OrderPage(lockCtx, domain.Query{State: "PUBLISHED", Page: 3, Limit: 1})
		if err != nil {
			return err
		}
		empty, err := tx.OrderPage(lockCtx, domain.Query{State: "CANCELLED", Page: 1, Limit: 10})
		if err != nil {
			return err
		}
		if firstPage.Total != 2 || len(firstPage.Items) != 1 || len(secondPage.Items) != 1 || firstPage.Items[0].ID <= secondPage.Items[0].ID {
			t.Fatalf("unstable queue pagination: %+v %+v", firstPage, secondPage)
		}
		if beyond.Total != 2 || len(beyond.Items) != 0 || empty.Total != 0 || len(empty.Items) != 0 {
			t.Fatalf("wrong empty page/count: %+v %+v", beyond, empty)
		}
		return nil
	}); err != nil {
		t.Fatal("queue read waited for an order write lock", err)
	}
}
