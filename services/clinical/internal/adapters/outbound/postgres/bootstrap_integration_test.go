//go:build integration

package postgres

import (
	"context"
	"strings"
	"testing"
	"umccare/clinical/internal/domain"
)

func TestTicketImportIdempotencyAndVersionGuard(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	ticket := domain.Ticket{ID: strings.ToUpper(domain.NewID()), AppointmentID: strings.ToUpper(domain.NewID()), PatientID: patientID, DoctorID: doctorID, DoctorUserID: doctorUser, DepartmentID: departmentID, TicketType: "FIRST", State: "WAITING", Version: 1}
	if err := db.ImportTickets(ctx, []domain.Ticket{ticket}); err != nil {
		t.Fatal(err)
	}
	if err := db.ImportTickets(ctx, []domain.Ticket{ticket}); err != nil {
		t.Fatal("same UUIDs with uppercase must replay", err)
	}
	conflicting := ticket
	conflicting.State = "CALLED"
	if err := db.ImportTickets(ctx, []domain.Ticket{conflicting}); domain.Code(err) != "VALIDATION_ERROR" {
		t.Fatal("same-version content changed", err)
	}
	newer := conflicting
	newer.Version = 2
	if err := db.ImportTickets(ctx, []domain.Ticket{newer}); err != nil {
		t.Fatal(err)
	}
	if err := db.ImportTickets(ctx, []domain.Ticket{ticket}); err != nil {
		t.Fatal(err)
	}
	var state string
	var version int
	if err := db.pool.QueryRow(ctx, `SELECT state,version FROM ticket_projection WHERE ticket_id=$1`, ticket.ID).Scan(&state, &version); err != nil || state != "CALLED" || version != 2 {
		t.Fatal(state, version, err)
	}
}
