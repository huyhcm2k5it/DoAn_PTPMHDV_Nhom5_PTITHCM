package usecase

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
	"unicode/utf8"
)

type Service struct {
	reader   ports.Reader
	prices   ports.PriceTransactions
	clock    ports.Clock
	cache    ports.ReadCache
	fallback chan struct{}
}

func New(r ports.Reader, p ports.PriceTransactions, c ports.Clock) *Service {
	return NewCached(r, p, c, nil, 10)
}

func NewCached(r ports.Reader, p ports.PriceTransactions, c ports.Clock, cache ports.ReadCache, maxFallback int) *Service {
	if maxFallback < 1 {
		maxFallback = 1
	}
	return &Service{reader: r, prices: p, clock: c, cache: cache, fallback: make(chan struct{}, maxFallback)}
}
func (s *Service) Departments(ctx context.Context) ([]domain.Department, error) {
	var result []domain.Department
	err := s.cached(ctx, "departments", struct{}{}, time.Time{}, &result, func() (any, error) {
		return s.reader.Departments(ctx)
	})
	return result, err
}
func (s *Service) Doctors(ctx context.Context, q ports.DoctorQuery) (ports.Doctors, error) {
	if q.Page == 0 {
		q.Page = 1
	}
	if q.Limit == 0 {
		q.Limit = 20
	}
	if q.Page < 1 || q.Page > 1000000 || q.Limit < 1 || q.Limit > 100 || (q.DepartmentID != "" && !domain.ValidID(q.DepartmentID)) {
		return ports.Doctors{}, domain.Fail("VALIDATION_ERROR", "Invalid doctor filter or pagination")
	}
	var result ports.Doctors
	err := s.cached(ctx, "doctors", q, time.Time{}, &result, func() (any, error) {
		return s.reader.Doctors(ctx, q)
	})
	return result, err
}
func (s *Service) MedicalServices(ctx context.Context, q ports.ServiceQuery) ([]domain.MedicalService, error) {
	if q.DepartmentID != "" && !domain.ValidID(q.DepartmentID) {
		return nil, domain.Fail("VALIDATION_ERROR", "Invalid departmentId")
	}
	atWasExplicit := !q.At.IsZero()
	if q.At.IsZero() {
		q.At = s.clock.Now()
	}
	cacheQuery := struct {
		DepartmentID string    `json:"departmentId"`
		At           time.Time `json:"at"`
		ExplicitAt   bool      `json:"explicitAt"`
	}{DepartmentID: q.DepartmentID, At: q.At, ExplicitAt: atWasExplicit}
	if !atWasExplicit {
		cacheQuery.At = q.At.Truncate(time.Minute)
	}
	var result []domain.MedicalService
	err := s.cached(ctx, "services", cacheQuery, q.At, &result, func() (any, error) {
		return s.reader.MedicalServices(ctx, q)
	})
	return result, err
}
func (s *Service) authorize(ctx context.Context, p domain.Principal, capabilities ...string) error {
	if p.UserID == "" {
		return domain.Fail("UNAUTHENTICATED", "Authentication required")
	}
	a, err := s.reader.Access(ctx, p.UserID)
	if err != nil {
		return err
	}
	if a.Status != "ACTIVE" || a.ActorType != p.ActorType || a.TokenVersion != p.TokenVersion {
		return domain.Fail("FORBIDDEN", "Account or token version is no longer authorized")
	}
	if p.ActorType == "DOCTOR" && len(capabilities) > 0 && capabilities[0] != "ADMIN" {
		return nil
	}
	if p.ActorType == "STAFF" {
		for _, capability := range capabilities {
			if domain.Has(a.Capabilities, capability) && domain.Has(p.Capabilities, capability) {
				return nil
			}
		}
	}
	return domain.Fail("FORBIDDEN", "Required capability is missing")
}
func validSearch(q ports.SearchQuery) bool {
	return utf8.RuneCountInString(q.Q) <= 200 && (q.Status == "" || q.Status == "ACTIVE" || q.Status == "INACTIVE")
}
func (s *Service) Medicines(ctx context.Context, p domain.Principal, q ports.SearchQuery) ([]domain.Medicine, error) {
	if err := s.authorize(ctx, p, "PHARMACY", "ADMIN"); err != nil {
		return nil, err
	}
	if !validSearch(q) {
		return nil, domain.Fail("VALIDATION_ERROR", "Invalid catalog filter")
	}
	q.Q = strings.TrimSpace(q.Q)
	at := s.clock.Now()
	var result []domain.Medicine
	err := s.cached(ctx, "medicines", struct {
		Query ports.SearchQuery `json:"query"`
		At    time.Time         `json:"at"`
	}{q, at.Truncate(time.Minute)}, at, &result, func() (any, error) {
		return s.reader.Medicines(ctx, q, at)
	})
	return result, err
}
func (s *Service) LabTests(ctx context.Context, p domain.Principal, q ports.SearchQuery) ([]domain.LabTest, error) {
	if err := s.authorize(ctx, p, "LAB_TECH", "LAB_REVIEW", "ADMIN"); err != nil {
		return nil, err
	}
	if !validSearch(q) {
		return nil, domain.Fail("VALIDATION_ERROR", "Invalid catalog filter")
	}
	q.Q = strings.TrimSpace(q.Q)
	at := s.clock.Now()
	var result []domain.LabTest
	err := s.cached(ctx, "lab-tests", struct {
		Query ports.SearchQuery `json:"query"`
		At    time.Time         `json:"at"`
	}{q, at.Truncate(time.Minute)}, at, &result, func() (any, error) {
		return s.reader.LabTests(ctx, q, at)
	})
	return result, err
}

func (s *Service) authorizePriceTx(ctx context.Context, tx ports.PriceTx, p domain.Principal) error {
	access, err := tx.AccessForShare(ctx, p.UserID)
	if err != nil {
		return err
	}
	if access.Status != "ACTIVE" || access.ActorType != "STAFF" || access.TokenVersion != p.TokenVersion || !domain.Has(access.Capabilities, "ADMIN") || !domain.Has(p.Capabilities, "ADMIN") || !p.LeaseExpiresAt.After(s.clock.Now()) {
		return domain.Fail("FORBIDDEN", "Administrator access or authorization lease is no longer valid")
	}
	return nil
}

func (s *Service) CreatePrice(ctx context.Context, p domain.Principal, key string, input domain.PriceInput, meta ports.Meta) (result domain.PriceResult, err error) {
	if err = s.authorize(ctx, p, "ADMIN"); err != nil {
		return
	}
	if p.LeaseAction != "CA-004" || !p.LeaseExpiresAt.After(s.clock.Now()) {
		err = domain.Fail("FORBIDDEN", "A current CA-004 authorization lease is required")
		return
	}
	if !domain.ValidID(key) {
		err = domain.Fail("VALIDATION_ERROR", "Idempotency-Key must be a UUID")
		return
	}
	// Canonical UTC instants make equivalent request timestamps hash identically.
	input.EffectiveFrom = input.EffectiveFrom.UTC()
	if input.EffectiveTo != nil {
		x := input.EffectiveTo.UTC()
		input.EffectiveTo = &x
	}
	raw, _ := json.Marshal(input)
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	now := s.clock.Now()
	changed := false
	err = s.prices.Within(ctx, p.UserID, key, func(tx ports.PriceTx) error {
		old, oldHash, found, e := tx.Replay(ctx, p.UserID, key)
		if e != nil {
			return e
		}
		if !p.LeaseExpiresAt.After(s.clock.Now()) {
			return domain.Fail("FORBIDDEN", "Authorization lease expired while processing the request")
		}
		if found {
			if e = s.authorizePriceTx(ctx, tx, p); e != nil {
				return e
			}
			if hash != oldHash {
				return domain.Fail("IDEMPOTENCY_CONFLICT", "Key already used for another price request")
			}
			result = old
			return nil
		}
		if e = input.Validate(now); e != nil {
			return e
		}
		exists, e := tx.LockItem(ctx, input.ItemType, input.ItemID)
		if e != nil {
			return e
		}
		if !exists {
			return domain.Fail("VALIDATION_ERROR", "Catalog item does not exist or is inactive")
		}
		if e = s.authorizePriceTx(ctx, tx, p); e != nil {
			return e
		}
		if !p.LeaseExpiresAt.After(s.clock.Now()) {
			return domain.Fail("FORBIDDEN", "Authorization lease expired while waiting for the item")
		}
		if e = input.Validate(s.clock.Now()); e != nil {
			return e
		}
		overlap, e := tx.Overlap(ctx, input)
		if e != nil {
			return e
		}
		if overlap {
			return domain.Fail("OVERLAPPING_PRICE_PERIOD", "Price effective periods overlap")
		}
		revision, e := tx.NextRevision(ctx, input.ItemType, input.ItemID)
		if e != nil {
			return e
		}
		price := domain.Price{PriceVersionID: domain.NewID(), Revision: revision, PriceInput: input}
		if e = tx.InsertPrice(ctx, price); e != nil {
			return e
		}
		sequence, e := tx.NextSequence(ctx)
		if e != nil {
			return e
		}
		if e = tx.AppendChanged(ctx, ports.Changed{MessageID: domain.NewID(), CorrelationID: meta.CorrelationID, RequestID: meta.RequestID, OccurredAt: now, Price: price, Sequence: sequence}); e != nil {
			return e
		}
		result = domain.PriceResult{PriceVersionID: price.PriceVersionID, Revision: revision, EffectiveFrom: price.EffectiveFrom}
		if e = tx.SaveReplay(ctx, p.UserID, key, hash, result); e != nil {
			return e
		}
		if !p.LeaseExpiresAt.After(s.clock.Now()) {
			return domain.Fail("FORBIDDEN", "Authorization lease expired before committing the price")
		}
		changed = true
		return nil
	})
	if err == nil && changed && s.cache != nil {
		// The database commit is authoritative. Cache invalidation is best effort
		// and must never turn a committed price into an HTTP failure. Preserve
		// request metadata but finish invalidation if the client disconnects.
		invalidateCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 150*time.Millisecond)
		_ = s.cache.BumpGeneration(invalidateCtx)
		cancel()
	}
	return
}
