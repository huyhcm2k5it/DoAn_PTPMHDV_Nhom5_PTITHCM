//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/url"
	"os"
	"strings"
	"testing"
	"umccare/catalog/internal/domain"
)

func TestDoctorMappingRepairPublishesVersionedOwnerEvidence(t *testing.T) {
	ctx := context.Background()
	dsn := os.Getenv("TEST_DATABASE_URL")
	u, _ := url.Parse(dsn)
	if u == nil || !strings.HasPrefix(u.Path, "/umc_huy_test") {
		t.Fatal("isolated umc_huy_test database required")
	}
	admin, err := New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "mapping_" + strings.ReplaceAll(domain.NewID(), "-", "")
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.pool.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatal(err)
	}
	defer admin.pool.Exec(context.Background(), "DROP SCHEMA "+identifier+" CASCADE")
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = db.Seed(ctx); err != nil {
		t.Fatal(err)
	}
	const doctor = "00000000-0000-4000-8000-000000000101"
	const staff = "00000000-0000-4000-8000-000000000901"
	const target = "00000000-0000-4000-8000-000000000911"
	if _, err = db.pool.Exec(ctx, "UPDATE doctors SET identity_user_id=$2 WHERE id=$1", doctor, staff); err != nil {
		t.Fatal(err)
	}
	change := DoctorMappingChange{DoctorID: doctor, ExpectedIdentityUserID: staff, IdentityUserID: target, Operator: "huy-test", Reason: "Repair verified demo doctor"}
	result, err := db.RebindDoctor(ctx, change)
	if err != nil {
		t.Fatal("valid owner repair failed:", err)
	}
	if result.Revision != 2 || result.IdentityUserID != target || result.Sequence < 1 || !domain.ValidID(result.MessageID) {
		t.Fatalf("invalid repair result %+v", result)
	}
	again, err := db.RebindDoctor(ctx, change)
	if err != nil || again != result {
		t.Fatalf("retry generated new evidence: %+v %v", again, err)
	}
	var body []byte
	if err = db.pool.QueryRow(ctx, "SELECT payload FROM outbox WHERE message_id=$1", result.MessageID).Scan(&body); err != nil {
		t.Fatal(err)
	}
	var event struct {
		AggregateVersion int
		Payload          struct {
			EntityVersion  int
			StreamSequence int64
			FullSnapshot   struct {
				IdentityUserID string `json:"identityUserId"`
			}
		}
	}
	if err = json.Unmarshal(body, &event); err != nil {
		t.Fatal(err)
	}
	if event.AggregateVersion != 2 || event.Payload.EntityVersion != 2 || event.Payload.StreamSequence != result.Sequence || event.Payload.FullSnapshot.IdentityUserID != target {
		t.Fatalf("bad owner event %s", body)
	}
	snap, err := db.ExportCatalogSnapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range snap.Entities {
		if e.EntityType == "DOCTOR" && e.EntityID == doctor {
			found = true
			if e.EntityVersion != 2 {
				t.Fatal("snapshot reverted doctor revision")
			}
		}
	}
	if !found {
		t.Fatal("doctor missing from snapshot")
	}
	rejected := change
	rejected.ExpectedIdentityUserID = target
	rejected.IdentityUserID = staff
	if _, err = db.RebindDoctor(ctx, rejected); domain.Code(err) != "STATE_CONFLICT" {
		t.Fatalf("staff account accepted as doctor: %v", err)
	}
	fresh := domain.NewID()
	if _, err = db.pool.Exec(ctx, "INSERT INTO user_access_projection(user_id,actor_type,status,token_version) VALUES($1,'DOCTOR','ACTIVE',1)", fresh); err != nil {
		t.Fatal(err)
	}
	if _, err = db.pool.Exec(ctx, `CREATE FUNCTION fail_mapping_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$; CREATE TRIGGER fail_mapping_outbox BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION fail_mapping_outbox()`); err != nil {
		t.Fatal(err)
	}
	defer db.pool.Exec(context.Background(), "DROP TRIGGER fail_mapping_outbox ON outbox; DROP FUNCTION fail_mapping_outbox()")
	change.ExpectedIdentityUserID = target
	change.IdentityUserID = fresh
	if _, err = db.RebindDoctor(ctx, change); err == nil {
		t.Fatal("outbox failure committed repair")
	}
	var actual string
	var revision int
	if err = db.pool.QueryRow(ctx, "SELECT identity_user_id::text,revision FROM doctors WHERE id=$1", doctor).Scan(&actual, &revision); err != nil {
		t.Fatal(err)
	}
	if actual != target || revision != 2 {
		t.Fatal("mapping escaped rollback", actual, revision)
	}

}
