package httpadapter

import (
	"context"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"umccare/diagnostic/internal/domain"
)

type LeaseClaims struct {
	Action       string `json:"action"`
	TokenVersion int    `json:"tokenVersion"`
	jwt.RegisteredClaims
}

func (j *JWT) LeasePrincipal(_ context.Context, raw string, p domain.Principal, action string) (domain.Principal, error) {
	if j == nil || j.key == nil || j.issuer == "" || j.audience == "" {
		return p, domain.Fail("SERVICE_UNAVAILABLE", "Authorization lease verification unavailable")
	}
	var c LeaseClaims
	_, err := jwt.ParseWithClaims(raw, &c, func(*jwt.Token) (any, error) { return j.key, nil }, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(j.issuer), jwt.WithAudience(j.audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil || domain.ID(c.Subject) != domain.ID(p.UserID) || c.TokenVersion != p.TokenVersion || c.Action != action || c.IssuedAt == nil || c.ExpiresAt == nil || !c.ExpiresAt.After(c.IssuedAt.Time) || c.ExpiresAt.Sub(c.IssuedAt.Time) > 30*time.Second {
		return p, domain.Fail("AUTHZ_LEASE_EXPIRED", "Current authorization lease required")
	}
	p.LeaseAction = action
	p.LeaseExpiresAt = c.ExpiresAt.Time
	return p, nil
}
