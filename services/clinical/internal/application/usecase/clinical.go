package usecase

import (
	"context"
	"encoding/json"
	"time"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

type Service struct {
	store ports.ClinicalStore
	now   func() time.Time
}

func New(store ports.ClinicalStore, now func() time.Time) *Service {
	return &Service{store: store, now: now}
}
func authorize(ctx context.Context, tx ports.ClinicalTx, p domain.Principal, actors ...string) error {
	if !domain.ValidID(p.UserID) {
		return domain.Fail("UNAUTHENTICATED", "Authentication required")
	}
	allowed := false
	for _, actor := range actors {
		if actor == p.ActorType {
			allowed = true
		}
	}
	if !allowed {
		return domain.Fail("FORBIDDEN", "Actor is not permitted")
	}
	access, err := tx.Access(ctx, domain.ID(p.UserID))
	if err != nil {
		return err
	}
	if access.ActorType != p.ActorType || access.Status != "ACTIVE" || access.TokenVersion != p.TokenVersion {
		return domain.Fail("FORBIDDEN", "Account or token is no longer authorized")
	}
	return nil
}
func (s *Service) Worklist(ctx context.Context, p domain.Principal, q domain.WorklistQuery) (result domain.Worklist, err error) {
	if err = q.Validate(); err != nil {
		return
	}
	err = s.store.Within(ctx, "", func(tx ports.ClinicalTx) error {
		if e := authorize(ctx, tx, p, "DOCTOR"); e != nil {
			return e
		}
		var e error
		result, e = tx.Worklist(ctx, domain.ID(p.UserID), q)
		if e != nil {
			return e
		}
		if q.OperationID != "" {
			r, e := tx.StartRequest(ctx, q.OperationID)
			if e != nil || r.DoctorUserID != domain.ID(p.UserID) {
				if e != nil && domain.Code(e) != "NOT_FOUND" {
					return e
				}
				return domain.Fail("START_REQUEST_NOT_FOUND", "Start request not found")
			}
			result.StartRequest = &r
		}
		return nil
	})
	return
}
func (s *Service) Start(ctx context.Context, p domain.Principal, key string, input domain.StartInput, meta domain.Meta) (result domain.StartResult, err error) {
	if err = input.Validate(); err != nil {
		return
	}
	if !domain.ValidID(key) {
		return result, domain.Fail("VALIDATION_ERROR", "UUID Idempotency-Key required")
	}
	key = domain.ID(key)
	p.UserID = domain.ID(p.UserID)
	hash := domain.Hash(input)
	err = s.store.Within(ctx, "", func(tx ports.ClinicalTx) error {
		if e := authorize(ctx, tx, p, "DOCTOR"); e != nil {
			return e
		}
		raw, h, found, e := tx.Replay(ctx, p.UserID, "CL-002", key)
		if e != nil {
			return e
		}
		if found {
			if h != hash {
				return domain.Fail("IDEMPOTENCY_CONFLICT", "Key already belongs to another request")
			}
			return json.Unmarshal(raw, &result)
		}
		ticket, e := tx.Ticket(ctx, input.TicketID)
		if e != nil {
			return e
		}
		if ticket.DoctorID != input.DoctorID || ticket.DoctorUserID != p.UserID {
			return domain.Fail("FORBIDDEN", "Ticket is not assigned to this doctor")
		}
		if ticket.Version != input.ExpectedTicketVersion {
			return domain.Fail("TICKET_VERSION_CONFLICT", "Ticket changed; reload its current version")
		}
		if ticket.State != "WAITING" && ticket.State != "CALLED" {
			return domain.Fail("TICKET_ALREADY_CLAIMED", "Ticket is no longer available")
		}
		id := domain.NewID()
		result = domain.StartResult{RequestID: id, OperationID: id, State: "PENDING", StatusURL: "/api/v1/clinical/worklist?operationId=" + id}
		r := domain.StartRequest{StartResult: result, DoctorUserID: p.UserID, Ticket: ticket, CreatedAt: s.now().UTC()}
		if e = tx.CreateStart(ctx, r); e != nil {
			return e
		}
		payload, _ := json.Marshal(domain.ClaimCommand{RequestID: id, TicketID: ticket.ID, ExpectedTicketVersion: ticket.Version, DoctorID: ticket.DoctorID, PatientID: ticket.PatientID})
		if meta.CorrelationID == "" {
			meta.CorrelationID = domain.NewID()
		}
		if !domain.ValidID(meta.RequestID) {
			meta.RequestID = domain.NewID()
		}
		message := domain.Envelope{MessageID: domain.NewID(), MessageKind: "COMMAND", MessageType: "ClaimQueueTicket", SchemaVersion: 1, Producer: "clinical", AggregateID: id, AggregateVersion: 1, CorrelationID: meta.CorrelationID, CausationID: meta.RequestID, RequestID: id, OccurredAt: s.now().UTC(), Payload: payload}
		if e = tx.AppendCommand(ctx, message); e != nil {
			return e
		}
		return tx.SaveReplay(ctx, p.UserID, "CL-002", key, hash, result)
	})
	return
}
func (s *Service) Detail(ctx context.Context, p domain.Principal, id string) (result domain.VisitDetail, err error) {
	if !domain.ValidID(id) {
		return result, domain.Fail("VALIDATION_ERROR", "UUID visitId required")
	}
	err = s.store.Within(ctx, "", func(tx ports.ClinicalTx) error {
		if e := authorize(ctx, tx, p, "DOCTOR", "PATIENT"); e != nil {
			return e
		}
		visit, e := tx.Visit(ctx, domain.ID(id))
		if e != nil {
			return e
		}
		if p.ActorType == "DOCTOR" && visit.DoctorUserID != domain.ID(p.UserID) {
			return domain.Fail("FORBIDDEN", "Visit belongs to another doctor")
		}
		if p.ActorType == "PATIENT" {
			if visit.State != "SIGNED" {
				return domain.Fail("NOT_FOUND", "Visit not found")
			}
			access, e := tx.PatientAccess(ctx, visit.PatientID)
			if e != nil {
				return e
			}
			if !access.Active || access.OwnerUserID != domain.ID(p.UserID) {
				return domain.Fail("NOT_FOUND", "Visit not found")
			}
		}
		notes, e := tx.Notes(ctx, visit.ID)
		if e != nil {
			return e
		}
		if p.ActorType == "PATIENT" && len(notes) > 1 {
			notes = notes[len(notes)-1:]
		}
		result = domain.VisitDetail{Visit: visit, Notes: notes, Prescriptions: []any{}, LabRequests: []any{}}
		return nil
	})
	return
}
func (s *Service) SaveDraft(ctx context.Context, p domain.Principal, id, key string, input domain.DraftInput) (result domain.DraftResult, err error) {
	if !domain.ValidID(id) || !domain.ValidID(key) {
		return result, domain.Fail("VALIDATION_ERROR", "UUID visitId and Idempotency-Key required")
	}
	if err = input.Validate(); err != nil {
		return
	}
	id = domain.ID(id)
	key = domain.ID(key)
	p.UserID = domain.ID(p.UserID)
	hash := domain.Hash(struct {
		ID    string
		Input domain.DraftInput
	}{id, input})
	err = s.store.Within(ctx, "visit:"+id, func(tx ports.ClinicalTx) error {
		if e := authorize(ctx, tx, p, "DOCTOR"); e != nil {
			return e
		}
		raw, h, found, e := tx.Replay(ctx, p.UserID, "CL-004", key)
		if e != nil {
			return e
		}
		if found {
			if h != hash {
				return domain.Fail("IDEMPOTENCY_CONFLICT", "Key already belongs to another draft")
			}
			return json.Unmarshal(raw, &result)
		}
		visit, e := tx.Visit(ctx, id)
		if e != nil {
			return e
		}
		if e = visit.CanDraft(p.UserID, input.ExpectedVersion); e != nil {
			return e
		}
		note := domain.VisitNote{ID: domain.NewID(), VisitID: id, Symptoms: *input.Symptoms, Findings: *input.Findings, Assessment: *input.Assessment, Diagnosis: *input.Diagnosis, AuthorUserID: p.UserID, SavedAt: s.now().UTC()}
		if e = tx.AppendNote(ctx, note); e != nil {
			return e
		}
		visit.Version++
		if e = tx.UpdateVisit(ctx, visit); e != nil {
			return e
		}
		result = domain.DraftResult{VisitID: id, Version: visit.Version, State: visit.State}
		return tx.SaveReplay(ctx, p.UserID, "CL-004", key, hash, result)
	})
	return
}

func (s *Service) HandleClaim(ctx context.Context, exchange string, event domain.Envelope) error {
	var claim domain.ClaimResult
	if e := strictJSON(event.Payload, &claim); e != nil {
		return domain.Fail("INVALID_MESSAGE", "Malformed claim payload")
	}
	if e := event.ValidateClaim(exchange, claim); e != nil {
		return e
	}
	claim.RequestID = domain.ID(claim.RequestID)
	claim.TicketID = domain.ID(claim.TicketID)
	claim.AppointmentID = domain.ID(claim.AppointmentID)
	claim.PatientID = domain.ID(claim.PatientID)
	claim.VisitID = domain.ID(claim.VisitID)
	claim.ClaimID = domain.ID(claim.ClaimID)
	messageHash := domain.Hash(event)
	claimHash := domain.Hash(claim)
	return s.store.Within(ctx, "claim:"+claim.RequestID, func(tx ports.ClinicalTx) error {
		seen, e := tx.SeenMessage(ctx, domain.ID(event.MessageID), messageHash, retryLease(ctx))
		if e != nil || seen {
			return e
		}
		request, e := tx.StartRequest(ctx, claim.RequestID)
		if e != nil {
			return e
		}
		ticket := request.Ticket
		if ticket.ID != claim.TicketID || ticket.PatientID != claim.PatientID || ticket.AppointmentID != claim.AppointmentID {
			return domain.Fail("INVALID_MESSAGE", "Claim does not match trusted ticket snapshot")
		}
		if request.State != "PENDING" {
			if request.ClaimHash != claimHash {
				return domain.Fail("INVALID_MESSAGE", "Contradicting terminal claim result")
			}
			return tx.MarkMessage(ctx, domain.ID(event.MessageID), messageHash)
		}
		if claim.State == "ACCEPTED" {
			visit, found, e := tx.VisitByAppointment(ctx, claim.AppointmentID)
			if e != nil {
				return e
			}
			if ticket.TicketType == "FIRST" {
				if claim.VisitID != "" {
					return domain.Fail("INVALID_MESSAGE", "FIRST does not supply a Clinical visit ID")
				}
				if !found {
					visit = domain.Visit{ID: domain.NewID(), AppointmentID: claim.AppointmentID, PatientID: claim.PatientID, DoctorUserID: ticket.DoctorUserID, DepartmentID: ticket.DepartmentID, ClaimID: claim.ClaimID, State: "IN_PROGRESS", Version: 1, StartedAt: s.now().UTC()}
					if e = tx.InsertVisit(ctx, visit); e != nil {
						return e
					}
				} else if visit.ClaimID != claim.ClaimID {
					return domain.Fail("INVALID_MESSAGE", "Appointment already has another claim")
				}
			} else {
				if !found || ticket.VisitID != visit.ID || claim.VisitID != visit.ID || visit.PatientID != claim.PatientID || visit.DoctorUserID != ticket.DoctorUserID || visit.ReturnRound != 0 || (visit.State != "RETURN_READY" && visit.State != "WAITING_RETURN") {
					return domain.Fail("INVALID_MESSAGE", "RETURN must resume the existing eligible visit")
				}
				visit.State = "IN_PROGRESS"
				visit.ReturnRound = 1
				visit.ClaimID = claim.ClaimID
				visit.Version++
				if e = tx.UpdateVisit(ctx, visit); e != nil {
					return e
				}
			}
			request.VisitID = visit.ID
			request.ClaimID = claim.ClaimID
		}
		request.State = claim.State
		request.ReasonCode = claim.ReasonCode
		request.ClaimHash = claimHash
		if e = tx.UpdateStart(ctx, request); e != nil {
			return e
		}
		return tx.MarkMessage(ctx, domain.ID(event.MessageID), messageHash)
	})
}
