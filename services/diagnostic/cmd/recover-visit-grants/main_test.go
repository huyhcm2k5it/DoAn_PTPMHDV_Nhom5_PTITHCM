package main

import (
	"testing"
	"umccare/diagnostic/internal/application/projection"
	"umccare/diagnostic/internal/domain"
)

func TestOwnerSnapshotValidation(t *testing.T) {
	active, cancel := true, false
	grant := projection.VisitGrantEvent{Mode: "UPSERT", Sequence: 9, VisitID: domain.NewID(), PatientID: domain.NewID(), DoctorUserID: domain.NewID(), Active: &active, CanCancel: &cancel}
	valid := snapshot{Sequence: 9, Last: projection.VisitGrantEvent{Mode: "CHECKPOINT", Sequence: 9}, Grants: []projection.VisitGrantEvent{grant}}
	if err := validateSnapshot(valid); err != nil {
		t.Fatal(err)
	}
	revoked := valid
	revoked.Grants = append([]projection.VisitGrantEvent(nil), valid.Grants...)
	no := false
	revoked.Grants[0].Active = &no
	if err := validateSnapshot(revoked); err != nil {
		t.Fatal("explicit revocation must remain valid", err)
	}
	for _, kind := range []string{"duplicate", "missing authority", "watermark", "revoked cancel"} {
		s := valid
		s.Grants = append([]projection.VisitGrantEvent(nil), valid.Grants...)
		switch kind {
		case "duplicate":
			s.Grants = append(s.Grants, grant)
		case "missing authority":
			s.Grants[0].Active = nil
		case "watermark":
			s.Last.Sequence = 10
		case "revoked cancel":
			s.Grants[0].Active = &no
			s.Grants[0].CanCancel = &active
		}
		if err := validateSnapshot(s); err == nil {
			t.Fatalf("accepted unsafe snapshot: %s", kind)
		}
	}
}
