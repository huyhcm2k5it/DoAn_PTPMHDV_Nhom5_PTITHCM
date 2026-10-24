package httpadapter

import (
	"context"
	"crypto/rsa"
	"github.com/golang-jwt/jwt/v5"
	"time"
	"umccare/catalog/internal/domain"
)

type Claims struct {
	ActorType    string   `json:"actorType,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
	TokenVersion int      `json:"tokenVersion"`
	Action       string   `json:"action,omitempty"`
	jwt.RegisteredClaims
}
type JWT struct {
	accessKey, leaseKey *rsa.PublicKey
	issuer, audience    string
}

func NewJWT(access, lease *rsa.PublicKey, issuer, audience string) *JWT {
	return &JWT{access, lease, issuer, audience}
}
func (j *JWT) parse(raw string, key *rsa.PublicKey) (Claims, error) {
	var claims Claims
	if key == nil {
		return claims, domain.Fail("SERVICE_UNAVAILABLE", "Identity verification not configured")
	}
	_, err := jwt.ParseWithClaims(raw, &claims, func(*jwt.Token) (any, error) { return key, nil }, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(j.issuer), jwt.WithAudience(j.audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	return claims, err
}
func (j *JWT) Authenticate(_ context.Context, raw, lease string, requireLease bool) (domain.Principal, error) {
	claims, err := j.parse(raw, j.accessKey)
	if err != nil {
		if domain.Code(err) == "SERVICE_UNAVAILABLE" && j.accessKey == nil {
			return domain.Principal{}, err
		}
		return domain.Principal{}, domain.Fail("UNAUTHENTICATED", "Invalid or expired access token")
	}
	if !domain.ValidID(claims.Subject) || !domain.Has([]string{"PATIENT", "DOCTOR", "STAFF"}, claims.ActorType) {
		return domain.Principal{}, domain.Fail("UNAUTHENTICATED", "Invalid access token subject or actor")
	}
	p := domain.Principal{UserID: claims.Subject, ActorType: claims.ActorType, Capabilities: claims.Capabilities, TokenVersion: claims.TokenVersion}
	if requireLease {
		l, e := j.parse(lease, j.leaseKey)
		if e != nil || l.Subject != p.UserID || l.Action != "CA-004" || l.TokenVersion != p.TokenVersion || l.IssuedAt == nil || l.ExpiresAt == nil || l.ExpiresAt.Time.Sub(l.IssuedAt.Time) > 30*time.Second || !l.ExpiresAt.Time.After(l.IssuedAt.Time) {
			return domain.Principal{}, domain.Fail("FORBIDDEN", "A valid authorization lease of at most 30 seconds is required")
		}
		p.LeaseAction = l.Action
	}
	return p, nil
}
