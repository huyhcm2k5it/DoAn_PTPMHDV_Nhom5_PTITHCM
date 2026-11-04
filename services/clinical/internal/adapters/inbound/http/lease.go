package httpadapter

import (
	"context"
	"github.com/golang-jwt/jwt/v5"
	"time"
	"umccare/clinical/internal/domain"
)

type LeaseClaims struct {
	Action       string `json:"action"`
	TokenVersion int    `json:"tokenVersion"`
	jwt.RegisteredClaims
}

func (j *JWT) VerifyLease(ctx context.Context, raw string, p domain.Principal, action string) error {
	_, e := j.LeasePrincipal(ctx, raw, p, action)
	return e
}
func (j *JWT) LeasePrincipal(_ context.Context, raw string, p domain.Principal, action string) (domain.Principal, error) {
	if j == nil || j.key == nil {
		return p, domain.Fail("SERVICE_UNAVAILABLE", "Identity verification unavailable")
	}
	var c LeaseClaims
	_, e := jwt.ParseWithClaims(raw, &c, func(*jwt.Token) (any, error) { return j.key, nil }, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(j.issuer), jwt.WithAudience(j.audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if e != nil || domain.ID(c.Subject) != domain.ID(p.UserID) || c.TokenVersion != p.TokenVersion || c.Action != action || c.IssuedAt == nil || c.ExpiresAt == nil || !c.ExpiresAt.After(c.IssuedAt.Time) || c.ExpiresAt.Sub(c.IssuedAt.Time) > 30*time.Second {
		return p, domain.Fail("AUTHZ_LEASE_EXPIRED", "A current authorization lease for this action is required")
	}
	p.LeaseAction = action
	p.LeaseExpiresAt = c.ExpiresAt.Time
	return p, nil
}
