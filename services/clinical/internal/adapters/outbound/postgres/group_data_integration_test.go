//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

func TestGroupClinicalDataRoundTrip(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	raw, err := os.ReadFile("../../../../../../docs/umc-care-demo-data.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Services struct {
			Clinical map[string]json.RawMessage
			Patient  struct {
				Patients []struct {
					ID          string
					OwnerUserID string
				}
			}
		}
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	data := fixture.Services.Clinical
	for _, table := range []string{"visits", "visit_notes", "prescriptions"} {
		if _, err = db.pool.Exec(ctx, "INSERT INTO "+table+" SELECT * FROM jsonb_populate_recordset(NULL::"+table+",$1::jsonb)", data[table]); err != nil {
			t.Fatalf("%s: %v", table, err)
		}
	}
	if _, err = db.pool.Exec(ctx, `INSERT INTO prescription_items
		SELECT (jsonb_populate_record(NULL::prescription_items, item || jsonb_build_object('position', position-1))).*
		FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS source(item,position)`, data["prescription_items"]); err != nil {
		t.Fatal(err)
	}
	if _, err = db.pool.Exec(ctx, `INSERT INTO lab_requests(id,visit_id,state,order_id,request_hash,test_snapshot,version,created_at)
		SELECT id,visit_id,state,order_id,request_hash,test_snapshot,version,created_at
		FROM jsonb_populate_recordset(NULL::lab_requests,$1::jsonb)`, data["lab_requests"]); err != nil {
		t.Fatal(err)
	}
	var visits []struct {
		ID           string
		DoctorUserID string `json:"doctor_user_id"`
	}
	if err = json.Unmarshal(data["visits"], &visits); err != nil || len(visits) != 1 {
		t.Fatalf("visit fixture: %v", err)
	}
	v := visits[0]
	if _, err = db.pool.Exec(ctx, "INSERT INTO visit_doctor_grants(visit_id,active) VALUES($1,true)", v.ID); err != nil {
		t.Fatal(err)
	}
	var patientUserID string
	if err = db.pool.QueryRow(ctx, "SELECT patient_id::text FROM visits WHERE id=$1", v.ID).Scan(&patientUserID); err != nil {
		t.Fatal(err)
	}
	for _, patient := range fixture.Services.Patient.Patients {
		if patient.ID == patientUserID {
			if _, err = db.pool.Exec(ctx, `INSERT INTO patient_access_projection(patient_id,owner_user_id,active,policy_version)
				VALUES($1,$2,true,1)`, patient.ID, patient.OwnerUserID); err != nil {
				t.Fatal(err)
			}
			patientUserID = patient.OwnerUserID
			break
		}
	}
	if _, err = db.pool.Exec(ctx, `INSERT INTO user_access_projection(user_id,actor_type,status,token_version)
		VALUES($1,'DOCTOR','ACTIVE',1),($2,'PATIENT','ACTIVE',1)`, v.DoctorUserID, patientUserID); err != nil {
		t.Fatal(err)
	}
	app := usecase.New(db, time.Now)
	doctor := domain.Principal{UserID: v.DoctorUserID, ActorType: "DOCTOR", TokenVersion: 1}
	detail, err := app.Detail(ctx, doctor, v.ID)
	if err != nil || detail.Visit.State != "SIGNED" || len(detail.Notes) != 1 || len(detail.Prescriptions) != 1 || len(detail.LabRequests) != 1 {
		t.Fatalf("doctor detail: %+v %v", detail, err)
	}
	patient := domain.Principal{UserID: patientUserID, ActorType: "PATIENT", TokenVersion: 1}
	detail, err = app.Detail(ctx, patient, v.ID)
	if err != nil || len(detail.Prescriptions) != 1 || len(detail.LabRequests) != 0 {
		t.Fatalf("patient detail/filter: %+v %v", detail, err)
	}
	var quantity int
	var medicine, finalizedBy string
	if err = db.pool.QueryRow(ctx, `SELECT item.quantity,item.medicine_id::text,p.finalized_by::text
		FROM prescriptions p JOIN prescription_items item ON item.prescription_id=p.id WHERE p.visit_id=$1`, v.ID).Scan(&quantity, &medicine, &finalizedBy); err != nil || quantity != 10 || medicine != "b3c064cd-acd4-5cc2-9ba9-bc9d0c6a486f" || finalizedBy != v.DoctorUserID {
		t.Fatalf("prescription persistence: quantity=%d medicine=%s finalizedBy=%s err=%v", quantity, medicine, finalizedBy, err)
	}
	other := doctor
	other.UserID = domain.NewID()
	if _, err = db.pool.Exec(ctx, "INSERT INTO user_access_projection(user_id,actor_type,status,token_version) VALUES($1,'DOCTOR','ACTIVE',1)", other.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err = app.Detail(ctx, other, v.ID); domain.Code(err) != "FORBIDDEN" {
		t.Fatalf("unassigned doctor accessed fixture: %v", err)
	}
}
