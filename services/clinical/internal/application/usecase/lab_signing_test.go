package usecase

import (
	"testing"
	"umccare/clinical/internal/domain"
)

func TestUnresolvedLabsBlockSigning(t *testing.T) {
	for _, state := range []string{"PENDING", "CREATED", "FAILED", "REJECTED"} {
		t.Run(state, func(t *testing.T) {
			if labsResolved([]domain.LabRequest{{State: state}}) {
				t.Fatal("unresolved LAB permitted signing")
			}
		})
	}
	for _, state := range []string{"PUBLISHED", "CANCELLED", "SUPERSEDED"} {
		if !labsResolved([]domain.LabRequest{{State: state}}) {
			t.Fatalf("terminal LAB %s blocks signing", state)
		}
	}
}
