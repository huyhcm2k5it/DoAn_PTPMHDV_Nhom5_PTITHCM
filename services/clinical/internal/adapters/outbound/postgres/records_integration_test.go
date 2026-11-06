//go:build integration

package postgres

import (
	"context"
	"testing"
	"time"

	"umccare/clinical/internal/application/usecase"
	"umccare/clinical/internal/domain"
)

func TestMedicalRecordsOwnerLeaseAndSignedOnly(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	owner, other, doctor, patient, signed, draft := domain.NewID(), domain.NewID(), domain.NewID(), domain.NewID(), domain.NewID(), domain.NewID()
	_, err := db.pool.Exec(ctx, `INSERT INTO user_access_projection(user_id,actor_type,status,token_version) VALUES($1,'PATIENT','ACTIVE',1),($2,'PATIENT','ACTIVE',1),($3,'DOCTOR','ACTIVE',1)`, owner, other, doctor)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.pool.Exec(ctx, `INSERT INTO patient_access_projection(patient_id,owner_user_id,active,policy_version) VALUES($1,$2,true,1)`, patient, owner)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range []struct {
		id, state string
		signed    bool
	}{{signed, "SIGNED", true}, {draft, "IN_PROGRESS", false}} {
		var signedAt *time.Time
		if v.signed {
			signedAt = &now
		}
		_, err = db.pool.Exec(ctx, `INSERT INTO visits(id,appointment_id,patient_id,doctor_user_id,department_id,claim_id,state,version,started_at,signed_at)VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9)`, v.id, domain.NewID(), patient, doctor, domain.NewID(), domain.NewID(), v.state, now.Add(-time.Hour), signedAt)
		if err != nil {
			t.Fatal(err)
		}
	}
	_, err = db.pool.Exec(ctx, `INSERT INTO visit_notes(id,visit_id,revision,symptoms,findings,assessment,diagnosis,author_user_id,saved_at) VALUES($1,$2,1,'','','','SIGNED_NOTE',$3,$4),($5,$2,2,'','','','AFTER_SIGNING',$3,$6)`, domain.NewID(), signed, doctor, now.Add(-time.Minute), domain.NewID(), now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.pool.Exec(ctx, `INSERT INTO prescriptions(id,visit_id,patient_id,state,version,revision,lines,finalized_at) VALUES($1,$2,$3,'FINAL',1,1,'[]'::jsonb,$4),($5,$2,$3,'DRAFT',1,1,'[]'::jsonb,NULL)`, domain.NewID(), signed, patient, now.Add(-time.Minute), domain.NewID())
	if err != nil {
		t.Fatal(err)
	}
	request, order, cancelledRequest, cancelledOrder := domain.NewID(), domain.NewID(), domain.NewID(), domain.NewID()
	_, err = db.pool.Exec(ctx, `INSERT INTO lab_requests(request_id,visit_id,state,order_id,request_hash,tests) VALUES($1,$2,'PUBLISHED',$3,'request-a','[]'::jsonb),($4,$2,'CANCELLED',$5,'request-b','[]'::jsonb)`, request, signed, order, cancelledRequest, cancelledOrder)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.pool.Exec(ctx, `INSERT INTO lab_terminal_projection(request_id,visit_id,order_id,state,semantic_hash,revision,published_at) VALUES($1,$2,$3,'PUBLISHED','hash-a',3,$4),($5,$2,$6,'CANCELLED','hash-b',NULL,NULL)`, request, signed, order, now.Add(-time.Minute), cancelledRequest, cancelledOrder)
	if err != nil {
		t.Fatal(err)
	}
	app := usecase.New(db, time.Now)
	p := domain.Principal{UserID: owner, ActorType: "PATIENT", TokenVersion: 1, LeaseAction: "CL-011", LeaseExpiresAt: now.Add(time.Minute)}
	result, err := app.Records(ctx, p, patient, 1, 20)
	if err != nil || result.Total != 1 || len(result.Items) != 1 || result.Items[0].Visit.ID != signed || result.Items[0].Note.Diagnosis != "SIGNED_NOTE" || len(result.Items[0].Prescriptions) != 1 || result.Items[0].Prescriptions[0].State != "FINAL" {
		t.Fatalf("unexpected records: %+v %v", result, err)
	}
	if len(result.Items[0].PublishedLabResults) != 1 || result.Items[0].PublishedLabResults[0].OrderID != order || result.Items[0].PublishedLabResults[0].Revision != 3 {
		t.Fatalf("invalid published references: %+v", result.Items[0].PublishedLabResults)
	}
	p.UserID = other
	if _, err = app.Records(ctx, p, patient, 1, 20); domain.Code(err) != "NOT_FOUND" {
		t.Fatal("cross-patient read accepted", err)
	}
	p.UserID, p.ActorType = doctor, "DOCTOR"
	if _, err = app.Records(ctx, p, patient, 1, 20); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatal("unverified doctor grant accepted", err)
	}
	p.UserID, p.ActorType, p.LeaseExpiresAt = owner, "PATIENT", now.Add(-time.Second)
	if _, err = app.Records(ctx, p, patient, 1, 20); domain.Code(err) != "AUTHZ_LEASE_EXPIRED" {
		t.Fatal("expired lease accepted", err)
	}
}
