package httpadapter

import (
	"context"
	"crypto/rsa"
	"github.com/golang-jwt/jwt/v5"
	"strings"
	"umccare/clinical/internal/domain"
)

type Claims struct {
	ActorType    string `json:"actorType"`
	TokenVersion int    `json:"tokenVersion"`
	jwt.RegisteredClaims
}
type JWT struct {
	key              *rsa.PublicKey
	issuer, audience string
}

func NewJWT(key *rsa.PublicKey, issuer, audience string) *JWT {
	return &JWT{key: key, issuer: issuer, audience: audience}
}
func (j *JWT) Authenticate(_ context.Context, raw string) (domain.Principal, error) {
	if j == nil || j.key == nil || j.issuer == "" || j.audience == "" {
		return domain.Principal{}, domain.Fail("SERVICE_UNAVAILABLE", "Identity verification is not configured")
	}
	var claims Claims
	_, err := jwt.ParseWithClaims(raw, &claims, func(*jwt.Token) (any, error) { return j.key, nil }, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(j.issuer), jwt.WithAudience(j.audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil || !domain.ValidID(claims.Subject) || claims.TokenVersion < 0 || (claims.ActorType != "DOCTOR" && claims.ActorType != "PATIENT" && claims.ActorType != "STAFF") {
		return domain.Principal{}, domain.Fail("UNAUTHENTICATED", "Invalid or expired access token")
	}
	return domain.Principal{UserID: strings.ToLower(claims.Subject), ActorType: claims.ActorType, TokenVersion: claims.TokenVersion}, nil
}
