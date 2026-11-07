package usecase

import (
	"context"
	"strings"
	"unicode/utf8"

	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

func (s *Service) CancelOrder(ctx context.Context, p domain.Principal, id, key string, in domain.CancelInput, meta domain.ResultMeta) (out domain.CancelData, err error) {
	if !domain.ValidID(id) || !domain.ValidID(key) || in.ExpectedVersion < 1 || strings.TrimSpace(in.ReasonCode) == "" || utf8.RuneCountInString(in.ReasonCode) > 128 {
		return out, domain.Fail("VALIDATION_ERROR", "Order, version and reason are required")
	}
	hash := domain.Hash(map[string]any{"id": domain.ID(id), "input": in})
	rk := domain.ID(p.UserID) + ":DI-012:" + domain.ID(key)
	err = s.store.Within(ctx, "diagnostic:business", func(t ports.Tx) error {
		if p.ActorType != "DOCTOR" {
			return domain.Fail("FORBIDDEN", "Assigned doctor required")
		}
		if e := authorize(ctx, t, p, true); e != nil {
			return e
		}
		if p.LeaseAction != "DI-012" || !p.LeaseExpiresAt.After(s.now()) {
			return domain.Fail("AUTHZ_LEASE_EXPIRED", "Current cancellation lease required")
		}
		o, e := orders(ctx, t, id)
		if e != nil {
			return e
		}
		verifier, ok := t.(ports.VisitGrantVerifier)
		if !ok {
			return domain.Fail("SERVICE_UNAVAILABLE", "Current doctor-visit grant projection unavailable")
		}
		if e = verifier.VerifyVisitGrant(ctx, o.VisitID, domain.ID(p.UserID)); e != nil {
			return e
		}
		if !p.LeaseExpiresAt.After(s.now()) {
			return domain.Fail("AUTHZ_LEASE_EXPIRED", "Cancellation lease expired while waiting")
		}
		if found, e := replay(ctx, t, rk, hash, &out); e != nil || found {
			return e
		}
		if o.Version != in.ExpectedVersion || len(o.Specimens) != 0 || o.State != "PAID" || o.ChargeState != "PAID" || o.SettlementState != "SUCCEEDED" {
			return domain.Fail("STATE_CONFLICT", "Only a successfully settled, uncollected order can be cancelled")
		}
		cancellationID := domain.NewID()
		o.State = "CANCELLED"
		o.Version++
		out = domain.CancelData{Order: o, RefundStatus: "PENDING_SYNC"}
		if e = t.SaveOrder(ctx, o); e != nil {
			return e
		}
		if e = t.Put(ctx, "cancellation", o.ID, map[string]any{"cancellationId": cancellationID, "refundStatus": "PENDING_SYNC", "reasonCode": in.ReasonCode, "actorId": domain.ID(p.UserID), "at": s.now().UTC()}); e != nil {
			return e
		}
		cause := domain.Envelope{MessageID: domain.ID(key), CorrelationID: meta.CorrelationID, RequestID: o.RequestID}
		if e = s.emit(ctx, t, cause, "EVENT", "LabCancelled", o.ID, "diagnostic.lab-cancelled.v1", o.Version, map[string]any{"orderId": o.ID, "visitId": o.VisitID, "cancellationId": cancellationID, "noSpecimen": true, "reasonCode": in.ReasonCode, "version": o.Version}); e != nil {
			return e
		}
		return saveReplay(ctx, t, rk, hash, out)
	})
	return
}
