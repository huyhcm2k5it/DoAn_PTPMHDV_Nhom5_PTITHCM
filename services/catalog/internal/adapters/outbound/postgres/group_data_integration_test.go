//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
	"umccare/catalog/migrations"
)

func TestGroupCatalogDataAndLegacyUpgrade(t *testing.T) {
	ctx := context.Background()
	dsn, err := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	if err != nil || !strings.HasPrefix(dsn.Path, "/umc_huy_test") {
		t.Fatal("isolated umc_huy_test database required")
	}
	admin, err := New(ctx, dsn.String())
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "group_catalog_" + strings.ReplaceAll(domain.NewID(), "-", "")
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.pool.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatal(err)
	}
	defer admin.pool.Exec(ctx, "DROP SCHEMA "+identifier+" CASCADE")
	query := dsn.Query()
	query.Set("search_path", schema+",public")
	dsn.RawQuery = query.Encode()
	db, err := New(ctx, dsn.String())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// Reproduce an existing version 3 database, including optional fields left
	// at their old empty-string defaults. Empty databases alone miss this case.
	if _, err = db.pool.Exec(ctx, "CREATE TABLE schema_migrations(version integer PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	for i, name := range []string{"000001_catalog.up.sql", "000002_catalog_stream.up.sql", "000003_doctor_mapping.up.sql"} {
		raw, readErr := migrations.Files.ReadFile(name)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if _, err = db.pool.Exec(ctx, string(raw)); err != nil {
			t.Fatal(err)
		}
		if _, err = db.pool.Exec(ctx, "INSERT INTO schema_migrations VALUES($1)", i+1); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile("../../../../../../docs/umc-care-demo-data.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Services struct {
			Catalog map[string]json.RawMessage
		}
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	data := fixture.Services.Catalog
	for _, table := range []string{"departments", "medical_services", "medicines", "lab_tests", "price_versions"} {
		// The table names are an explicit test-only allowlist.
		sql := "INSERT INTO " + table + " SELECT * FROM jsonb_populate_recordset(NULL::" + table + ",$1::jsonb)"
		if _, err = db.pool.Exec(ctx, sql, data[table]); err != nil {
			t.Fatalf("%s: %v", table, err)
		}
	}
	if _, err = db.pool.Exec(ctx, `INSERT INTO doctors(id,identity_user_id,department_id,display_name,status)
		SELECT id,identity_user_id,department_id,display_name,status
		FROM jsonb_populate_recordset(NULL::doctors,$1::jsonb)`, data["doctors"]); err != nil {
		t.Fatal(err)
	}
	if _, err = db.pool.Exec(ctx, "UPDATE medicines SET strength='',form=' '; UPDATE lab_tests SET unit='',reference_range=' '"); err != nil {
		t.Fatal(err)
	}
	// An older demo reused the seed price UUID for different price content.
	// The UUID alone is insufficient evidence for assigning its audit actor.
	if _, err = db.pool.Exec(ctx, `INSERT INTO price_versions(id,item_type,item_id,revision,amount_vnd,effective_from)
		VALUES('00000000-0000-4000-8000-000000000501','EXAM','00000000-0000-4000-8000-000000000201',1,110000,'2026-11-01')`); err != nil {
		t.Fatal(err)
	}
	if err = db.Migrate(ctx); err == nil {
		t.Fatal("migration guessed a historical creator from a reused seed UUID")
	}
	var creator *string
	if err = db.pool.QueryRow(ctx, "SELECT created_by::text FROM price_versions WHERE id='00000000-0000-4000-8000-000000000501'").Scan(&creator); err != nil || creator != nil {
		t.Fatalf("failed migration changed creator: %v %v", creator, err)
	}
	if _, err = db.pool.Exec(ctx, "DELETE FROM price_versions WHERE id='00000000-0000-4000-8000-000000000501'"); err != nil {
		t.Fatal(err)
	}
	if err = db.Migrate(ctx); err != nil {
		t.Fatal("upgrade with existing empty descriptions failed", err)
	}
	if err = db.Migrate(ctx); err != nil {
		t.Fatal("migration retry failed", err)
	}
	var normalized bool
	if err = db.pool.QueryRow(ctx, `SELECT
		(SELECT bool_and(strength IS NULL AND form IS NULL) FROM medicines)
		AND (SELECT bool_and(unit IS NULL AND reference_range IS NULL) FROM lab_tests)`).Scan(&normalized); err != nil || !normalized {
		t.Fatalf("empty descriptions were not normalized: %v %v", normalized, err)
	}
	departments, err := db.Departments(ctx)
	if err != nil || len(departments) != 10 {
		t.Fatalf("departments: %d %v", len(departments), err)
	}
	doctors, err := db.Doctors(ctx, ports.DoctorQuery{Page: 1, Limit: 100})
	if err != nil || len(doctors.Items) != 30 || doctors.Total != 30 {
		t.Fatalf("doctors: %+v %v", doctors, err)
	}
	at := time.Date(2026, 11, 10, 2, 0, 0, 0, time.UTC)
	medicines, err := db.Medicines(ctx, ports.SearchQuery{Q: "MED-01", Status: "ACTIVE"}, at)
	if err != nil || len(medicines) != 1 || medicines[0].Price == nil || medicines[0].Price.AmountVND != 2000 {
		t.Fatalf("medicine price/read after normalization: %+v %v", medicines, err)
	}
	labs, err := db.LabTests(ctx, ports.SearchQuery{Q: "LAB-01", Status: "ACTIVE"}, at)
	if err != nil || len(labs) != 1 || labs[0].Price == nil || labs[0].Price.AmountVND != 100000 {
		t.Fatalf("LAB price/read after normalization: %+v %v", labs, err)
	}
	if err = db.BootstrapCatalogStream(ctx); err != nil {
		t.Fatal(err)
	}
	snapshot, err := db.ExportCatalogSnapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Assert the identities imported from the shared fixture, not a historical
	// row count: the group's medicine catalog can grow independently of this test.
	expected := map[string]bool{}
	for kind, table := range map[string]string{
		"DEPARTMENT": "departments", "DOCTOR": "doctors", "SERVICE": "medical_services",
		"MEDICINE": "medicines", "LAB_TEST": "lab_tests", "PRICE_VERSION": "price_versions",
	} {
		var rows []struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(data[table], &rows); err != nil || len(rows) == 0 {
			t.Fatalf("invalid or empty %s fixture: %v", table, err)
		}
		for _, row := range rows {
			key := kind + ":" + row.ID
			if !domain.ValidID(row.ID) || expected[key] {
				t.Fatalf("invalid or duplicate fixture identity %s", key)
			}
			expected[key] = true
		}
	}
	if len(snapshot.Entities) != len(expected) || snapshot.Watermark != int64(len(expected)) {
		t.Fatalf("group catalog snapshot: entities=%d watermark=%d err=%v", len(snapshot.Entities), snapshot.Watermark, err)
	}
	for _, entity := range snapshot.Entities {
		key := entity.EntityType + ":" + entity.EntityID
		if !expected[key] {
			t.Fatalf("unexpected or duplicate snapshot identity %s", key)
		}
		delete(expected, key)
	}
	if len(expected) != 0 {
		t.Fatalf("snapshot omitted %d fixture identities", len(expected))
	}
}
