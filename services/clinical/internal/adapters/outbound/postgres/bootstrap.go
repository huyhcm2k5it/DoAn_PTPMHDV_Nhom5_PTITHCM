package postgres

import (
	"context"
	"encoding/json"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

// ImportTickets is an operator-only boundary for a trusted Appointment export.
// It is deliberately not exposed as HTTP and cannot mark claims accepted.
func (p *Probe) ImportTickets(ctx context.Context, tickets []domain.Ticket) error {
	return p.Within(ctx, "ticket-import", func(raw ports.ClinicalTx) error {
		t := raw.(clinicalTx)
		for _, v := range tickets {
			for _, id := range []string{v.ID, v.AppointmentID, v.PatientID, v.DoctorID, v.DoctorUserID, v.DepartmentID} {
				if !domain.ValidID(id) {
					return domain.Fail("VALIDATION_ERROR", "Invalid trusted ticket identity")
				}
			}
			if v.Version < 1 || v.Version > 2147483647 || (v.TicketType != "FIRST" && v.TicketType != "RETURN") || (v.TicketType == "FIRST" && v.VisitID != "") || (v.TicketType == "RETURN" && !domain.ValidID(v.VisitID)) {
				return domain.Fail("VALIDATION_ERROR", "Invalid trusted ticket type/version")
			}
			switch v.State {
			case "WAITING", "CALLED", "CLAIMED", "NO_SHOW", "DONE":
			default:
				return domain.Fail("VALIDATION_ERROR", "Invalid trusted ticket state")
			}
			for _, id := range []*string{&v.ID, &v.AppointmentID, &v.PatientID, &v.DoctorID, &v.DoctorUserID, &v.DepartmentID, &v.VisitID} {
				*id = domain.ID(*id)
			}
			var previous []byte
			e := t.tx.QueryRow(ctx, `SELECT jsonb_build_object('ticketId',ticket_id,'appointmentId',appointment_id,'patientId',patient_id,'doctorId',doctor_id,'doctorUserId',doctor_user_id,'departmentId',department_id,'ticketType',ticket_type,'state',state,'version',version,'visitId',COALESCE(visit_id::text,'')) FROM ticket_projection WHERE ticket_id=$1 FOR UPDATE`, v.ID).Scan(&previous)
			if e == nil {
				var prior domain.Ticket
				if e = json.Unmarshal(previous, &prior); e != nil {
					return e
				}
				if prior.Version == v.Version && domain.Hash(prior) != domain.Hash(v) {
					return domain.Fail("VALIDATION_ERROR", "Same ticket version has conflicting content")
				}
				if prior.Version >= v.Version {
					continue
				}
			}
			_, e = t.tx.Exec(ctx, `INSERT INTO ticket_projection(ticket_id,appointment_id,patient_id,doctor_id,doctor_user_id,department_id,ticket_type,state,version,visit_id)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,'')::uuid) ON CONFLICT(ticket_id)DO UPDATE SET appointment_id=EXCLUDED.appointment_id,patient_id=EXCLUDED.patient_id,doctor_id=EXCLUDED.doctor_id,doctor_user_id=EXCLUDED.doctor_user_id,department_id=EXCLUDED.department_id,ticket_type=EXCLUDED.ticket_type,state=EXCLUDED.state,version=EXCLUDED.version,visit_id=EXCLUDED.visit_id,applied_at=now() WHERE ticket_projection.version<EXCLUDED.version`, v.ID, v.AppointmentID, v.PatientID, v.DoctorID, v.DoctorUserID, v.DepartmentID, v.TicketType, v.State, v.Version, v.VisitID)
			if e != nil {
				return e
			}
		}
		return nil
	})
}
func (p *Probe) SeedDemo(ctx context.Context) error {
	_, e := p.pool.Exec(ctx, `INSERT INTO user_access_projection(user_id,actor_type,status,token_version)VALUES('11111111-0000-0000-0000-000000000001','DOCTOR','ACTIVE',1),('11111111-0000-0000-0000-000000000003','PATIENT','ACTIVE',1) ON CONFLICT DO NOTHING; INSERT INTO patient_access_projection(patient_id,owner_user_id,active,policy_version)VALUES('33333333-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000003',true,1) ON CONFLICT DO NOTHING;`)
	if e != nil {
		return e
	}
	return p.ImportTickets(ctx, []domain.Ticket{{ID: "55555555-0000-0000-0000-000000000001", AppointmentID: "66666666-0000-0000-0000-000000000001", PatientID: "33333333-0000-0000-0000-000000000001", DoctorID: "22222222-0000-0000-0000-000000000001", DoctorUserID: "11111111-0000-0000-0000-000000000001", DepartmentID: "44444444-0000-0000-0000-000000000001", TicketType: "FIRST", State: "WAITING", Version: 1}})
}
