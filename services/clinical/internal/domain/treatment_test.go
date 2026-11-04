package domain

import "testing"

func TestTreatmentGuards(t *testing.T) {
	good := PrescriptionInput{Lines: []PrescriptionLine{{MedicineCode: "MED", DoseText: "1", Quantity: 1}}}
	if err := good.Validate(false); err != nil {
		t.Fatal(err)
	}
	bad := good
	bad.Lines = []PrescriptionLine{{MedicineCode: "MED", DoseText: "1", Quantity: 0}}
	if Code(bad.Validate(false)) != "VALIDATION_ERROR" {
		t.Fatal("nonpositive quantity accepted")
	}
	if Code((LabInput{}).Validate()) != "VALIDATION_ERROR" {
		t.Fatal("empty lab accepted")
	}
	if Code((PrescriptionInput{}).Validate(false)) != "VALIDATION_ERROR" {
		t.Fatal("missing lines accepted")
	}
}
