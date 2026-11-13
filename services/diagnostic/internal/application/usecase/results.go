package usecase

import (
	"context"
	"sort"
	"strings"
	"unicode/utf8"

	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

func (s *Service) PublishedResults(ctx context.Context, p domain.Principal, patientID string, page, limit int) (out domain.PublishedResults, err error) {
	out.Items = []domain.Result{}
	if !domain.ValidID(patientID) || page < 1 || page > 1000000 || limit < 1 || limit > 100 {
		return out, domain.Fail("VALIDATION_ERROR", "Invalid patient or pagination")
	}
	if p.LeaseAction != "DI-013" || !p.LeaseExpiresAt.After(s.now()) {
		return out, domain.Fail("AUTHZ_LEASE_EXPIRED", "Current results read lease required")
	}
	if !domain.ValidID(p.UserID) {
		return out, domain.Fail("UNAUTHENTICATED", "Authentication required")
	}
	err = s.store.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		var e error
		var access domain.Access
		if e := load(ctx, t, "access", domain.ID(p.UserID), &access); e != nil {
			return domain.Fail("SERVICE_UNAVAILABLE", "Identity projection unavailable")
		}
		if access.Status != "ACTIVE" || access.ActorType != p.ActorType || access.TokenVersion != p.TokenVersion {
			return domain.Fail("FORBIDDEN", "Access revoked")
		}
		doctorReader, supportsDoctor := t.(ports.DoctorPublishedResultsRecords)
		if p.ActorType == "DOCTOR" && !supportsDoctor {
			return domain.Fail("SERVICE_UNAVAILABLE", "Current doctor-visit grant projection unavailable")
		}
		if p.ActorType != "PATIENT" && p.ActorType != "DOCTOR" {
			return domain.Fail("FORBIDDEN", "Patient owner required")
		}
		var patient struct {
			OwnerUserID string `json:"ownerUserId"`
			Active      bool   `json:"active"`
		}
		if e := load(ctx, t, "patient", domain.ID(patientID), &patient); domain.Code(e) == "NOT_FOUND" {
			return domain.Fail("NOT_FOUND", "Patient not found")
		} else if e != nil {
			return domain.Fail("SERVICE_UNAVAILABLE", "Patient access projection unavailable")
		}
		if !patient.Active || (p.ActorType == "PATIENT" && domain.ID(patient.OwnerUserID) != domain.ID(p.UserID)) {
			return domain.Fail("NOT_FOUND", "Patient not found")
		}
		if p.ActorType == "DOCTOR" {
			out, e = doctorReader.PublishedResultsForDoctor(ctx, domain.ID(patientID), domain.ID(p.UserID), page, limit, s.now())
			if e != nil {
				return e
			}
		} else if reader, ok := t.(ports.PublishedResultsRecords); ok {
			out, e = reader.PublishedResultsForPatient(ctx, domain.ID(patientID), page, limit)
			if e != nil {
				return e
			}
		} else {
			orders, orderErr := t.Orders(ctx)
			if orderErr != nil {
				return orderErr
			}
			for _, order := range orders {
				if domain.ID(order.PatientID) != domain.ID(patientID) {
					continue
				}
				var resultID string
				if orderErr = load(ctx, t, "result-order", order.ID, &resultID); domain.Code(orderErr) == "NOT_FOUND" {
					continue
				} else if orderErr != nil {
					return orderErr
				}
				var record resultRecord
				if orderErr = load(ctx, t, "result", domain.ID(resultID), &record); orderErr != nil {
					return orderErr
				}
				if record.Result.State == "PUBLISHED" && record.Result.PublishedAt != nil && record.Result.OrderID == order.ID {
					out.Items = append(out.Items, record.Result)
				}
			}
			sort.Slice(out.Items, func(i, j int) bool {
				if out.Items[i].PublishedAt.Equal(*out.Items[j].PublishedAt) {
					return out.Items[i].ID > out.Items[j].ID
				}
				return out.Items[i].PublishedAt.After(*out.Items[j].PublishedAt)
			})
			out.Total = len(out.Items)
			start := (page - 1) * limit
			if start > out.Total {
				start = out.Total
			}
			end := start + limit
			if end > out.Total {
				end = out.Total
			}
			out.Items = out.Items[start:end]
		}
		if !p.LeaseExpiresAt.After(s.now()) {
			out = domain.PublishedResults{Items: []domain.Result{}}
			return domain.Fail("AUTHZ_LEASE_EXPIRED", "Results read lease expired while waiting")
		}
		return nil
	})
	if err != nil {
		return domain.PublishedResults{Items: []domain.Result{}}, err
	}
	return
}

type resultRecord struct {
	Result       domain.Result `json:"result"`
	Contributors []string      `json:"contributors"`
}

func (s *Service) resultAccess(ctx context.Context, t ports.Tx, p domain.Principal, action, capability string) error {
	if !domain.ValidID(p.UserID) {
		return domain.Fail("UNAUTHENTICATED", "Authentication required")
	}
	var a domain.Access
	if err := load(ctx, t, "access", domain.ID(p.UserID), &a); err != nil {
		return domain.Fail("SERVICE_UNAVAILABLE", "Identity projection unavailable")
	}
	if p.ActorType != "STAFF" || a.ActorType != "STAFF" || a.Status != "ACTIVE" || a.TokenVersion != p.TokenVersion || !domain.Has(a.Capabilities, capability) || !domain.Has(p.Capabilities, capability) {
		return domain.Fail("FORBIDDEN", "Required LAB capability missing")
	}
	if action != "DI-007" && action != "DI-010" && (p.LeaseAction != action || !p.LeaseExpiresAt.After(s.now())) {
		return domain.Fail("AUTHZ_LEASE_EXPIRED", "Current authorization lease required")
	}
	return nil
}

func resultItems(in []domain.ResultItemInput, tests []domain.TestSnapshot) ([]domain.ResultItem, error) {
	if len(in) == 0 || len(in) > 100 {
		return nil, domain.Fail("VALIDATION_ERROR", "One to 100 results required")
	}
	known := map[string]domain.TestSnapshot{}
	for _, x := range tests {
		known[x.Code] = x
	}
	seen := map[string]bool{}
	out := make([]domain.ResultItem, 0, len(in))
	for _, x := range in {
		test, ok := known[x.TestCode]
		if !ok || seen[x.TestCode] || strings.TrimSpace(x.ValueText) == "" || utf8.RuneCountInString(x.ValueText) > 2000 || utf8.RuneCountInString(x.Flag) > 100 || (x.Unit != "" && x.Unit != test.Unit) || (x.ReferenceRange != "" && x.ReferenceRange != test.ReferenceRange) {
			return nil, domain.Fail("VALIDATION_ERROR", "Result must match the ordered test, unit and reference range")
		}
		x.Unit = test.Unit
		x.ReferenceRange = test.ReferenceRange
		seen[x.TestCode] = true
		out = append(out, domain.ResultItem{ID: domain.NewID(), ResultItemInput: x})
	}
	return out, nil
}

func (s *Service) CreateResult(ctx context.Context, p domain.Principal, id, key string, in domain.ResultCreateInput) (out domain.Result, err error) {
	if !domain.ValidID(id) || !domain.ValidID(key) {
		return out, domain.Fail("VALIDATION_ERROR", "UUID required")
	}
	hash := domain.Hash(map[string]any{"id": domain.ID(id), "input": in})
	rk := domain.ID(p.UserID) + ":result-create:" + domain.ID(key)
	err = s.store.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		if e := s.resultAccess(ctx, t, p, "DI-007", "LAB_TECH"); e != nil {
			return e
		}
		if found, e := replay(ctx, t, rk, hash, &out); e != nil || found {
			return e
		}
		o, e := orders(ctx, t, id)
		if e != nil {
			return e
		}
		if o.State != "SPECIMEN_COLLECTED" || len(o.Specimens) == 0 || o.Specimens[len(o.Specimens)-1].State != "COLLECTED" {
			return domain.Fail("STATE_CONFLICT", "Collected specimen required")
		}
		var existing string
		if e = load(ctx, t, "result-order", o.ID, &existing); e == nil {
			return domain.Fail("STATE_CONFLICT", "Result already exists")
		} else if domain.Code(e) != "NOT_FOUND" {
			return e
		}
		items, e := resultItems(in.Items, o.Tests)
		if e != nil {
			return e
		}
		out = domain.Result{ID: domain.NewID(), OrderID: o.ID, SpecimenID: o.Specimens[len(o.Specimens)-1].ID, Revision: 1, State: "DRAFT", EnteredBy: domain.ID(p.UserID), Version: 1, Items: items}
		if e = t.Put(ctx, "result", out.ID, resultRecord{out, []string{domain.ID(p.UserID)}}); e != nil {
			return e
		}
		if e = t.Put(ctx, "result-order", o.ID, out.ID); e != nil {
			return e
		}
		if e = t.Put(ctx, "result-audit", domain.NewID(), map[string]any{"resultId": out.ID, "action": "CREATE", "actorId": domain.ID(p.UserID), "at": s.now().UTC()}); e != nil {
			return e
		}
		return saveReplay(ctx, t, rk, hash, out)
	})
	return
}

func (s *Service) UpdateResult(ctx context.Context, p domain.Principal, id, key string, in domain.ResultUpdateInput) (out domain.Result, err error) {
	if !domain.ValidID(id) || !domain.ValidID(key) || in.ExpectedVersion < 1 {
		return out, domain.Fail("VALIDATION_ERROR", "UUID and expectedVersion required")
	}
	hash := domain.Hash(map[string]any{"id": domain.ID(id), "input": in})
	rk := domain.ID(p.UserID) + ":result-update:" + domain.ID(key)
	err = s.store.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		if e := s.resultAccess(ctx, t, p, "DI-008", "LAB_TECH"); e != nil {
			return e
		}
		if found, e := replay(ctx, t, rk, hash, &out); e != nil || found {
			return e
		}
		var r resultRecord
		if e := load(ctx, t, "result", domain.ID(id), &r); e != nil {
			return e
		}
		if (r.Result.State != "DRAFT" && r.Result.State != "REWORK") || r.Result.Version != in.ExpectedVersion {
			return domain.Fail("STATE_CONFLICT", "Result state or version changed")
		}
		o, e := orders(ctx, t, r.Result.OrderID)
		if e != nil {
			return e
		}
		if o.State != "SPECIMEN_COLLECTED" || len(o.Specimens) == 0 || o.Specimens[len(o.Specimens)-1].ID != r.Result.SpecimenID || o.Specimens[len(o.Specimens)-1].State != "COLLECTED" {
			return domain.Fail("STATE_CONFLICT", "Specimen no longer active")
		}
		items, e := resultItems(in.Items, o.Tests)
		if e != nil {
			return e
		}
		r.Result.Items = items
		r.Result.EnteredBy = domain.ID(p.UserID)
		r.Result.Revision++
		r.Result.Version++
		if !domain.Has(r.Contributors, domain.ID(p.UserID)) {
			r.Contributors = append(r.Contributors, domain.ID(p.UserID))
		}
		out = r.Result
		if e = t.Put(ctx, "result", out.ID, r); e != nil {
			return e
		}
		if e = t.Put(ctx, "result-audit", domain.NewID(), map[string]any{"resultId": out.ID, "action": "UPDATE", "actorId": domain.ID(p.UserID), "at": s.now().UTC()}); e != nil {
			return e
		}
		return saveReplay(ctx, t, rk, hash, out)
	})
	return
}

func (s *Service) TransitionResult(ctx context.Context, p domain.Principal, id, key, action string, version int, reason string, meta domain.ResultMeta) (out domain.Result, err error) {
	if !domain.ValidID(id) || !domain.ValidID(key) || version < 1 || !domain.Has([]string{"DI-009", "DI-010", "DI-011"}, action) || (action == "DI-010" && (strings.TrimSpace(reason) == "" || utf8.RuneCountInString(reason) > 2000)) {
		return out, domain.Fail("VALIDATION_ERROR", "Invalid result transition")
	}
	capability := "LAB_REVIEW"
	if action == "DI-009" {
		capability = "LAB_TECH"
	}
	hash := domain.Hash(map[string]any{"id": domain.ID(id), "version": version, "reason": reason})
	rk := domain.ID(p.UserID) + ":" + action + ":" + domain.ID(key)
	err = s.store.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		if e := s.resultAccess(ctx, t, p, action, capability); e != nil {
			return e
		}
		if found, e := replay(ctx, t, rk, hash, &out); e != nil || found {
			return e
		}
		var r resultRecord
		if e := load(ctx, t, "result", domain.ID(id), &r); e != nil {
			return e
		}
		if r.Result.Version != version {
			return domain.Fail("STATE_CONFLICT", "Result version changed")
		}
		o, e := orders(ctx, t, r.Result.OrderID)
		if e != nil {
			return e
		}
		if o.State != "SPECIMEN_COLLECTED" || len(o.Specimens) == 0 || o.Specimens[len(o.Specimens)-1].ID != r.Result.SpecimenID || o.Specimens[len(o.Specimens)-1].State != "COLLECTED" {
			return domain.Fail("STATE_CONFLICT", "Specimen no longer active")
		}
		now := s.now().UTC()
		if action == "DI-009" {
			if (r.Result.State != "DRAFT" && r.Result.State != "REWORK") || len(r.Result.Items) != len(o.Tests) {
				return domain.Fail("STATE_CONFLICT", "Complete draft required")
			}
			r.Result.State = "REVIEW"
			r.Result.SubmittedAt = &now
			if !domain.Has(r.Contributors, domain.ID(p.UserID)) {
				r.Contributors = append(r.Contributors, domain.ID(p.UserID))
			}
		} else {
			if r.Result.State != "REVIEW" {
				return domain.Fail("STATE_CONFLICT", "Result is not under review")
			}
			if domain.Has(r.Contributors, domain.ID(p.UserID)) {
				return domain.Fail("FORBIDDEN", "Reviewer must not have entered the result")
			}
			if action == "DI-010" {
				r.Result.State = "REWORK"
			} else {
				r.Result.State = "PUBLISHED"
				r.Result.PublishedAt = &now
			}
		}
		r.Result.Version++
		out = r.Result
		if e = t.Put(ctx, "result", out.ID, r); e != nil {
			return e
		}
		if e = t.Put(ctx, "result-audit", domain.NewID(), map[string]any{"resultId": out.ID, "action": action, "actorId": domain.ID(p.UserID), "reason": reason, "at": now}); e != nil {
			return e
		}
		if action == "DI-011" {
			var patient struct {
				OwnerUserID string `json:"ownerUserId"`
				Active      bool   `json:"active"`
			}
			if e = load(ctx, t, "patient", o.PatientID, &patient); e != nil || !domain.ValidID(patient.OwnerUserID) {
				return domain.Fail("SERVICE_UNAVAILABLE", "Patient projection unavailable")
			}
			o.State = "PUBLISHED"
			o.Version++
			if e = t.SaveOrder(ctx, o); e != nil {
				return e
			}
			in := domain.Envelope{MessageID: domain.ID(key), CorrelationID: meta.CorrelationID, RequestID: o.RequestID}
			if e = s.emit(ctx, t, in, "EVENT", "LabResultPublished", o.ID, "diagnostic.lab-result-published.v1", o.Version, map[string]any{"orderId": o.ID, "visitId": o.VisitID, "revision": out.Revision, "publishedAt": now, "recipientUserId": domain.ID(patient.OwnerUserID), "version": o.Version}); e != nil {
				return e
			}
		}
		return saveReplay(ctx, t, rk, hash, out)
	})
	return
}
