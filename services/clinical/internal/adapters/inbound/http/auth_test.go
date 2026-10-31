package httpadapter

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"github.com/golang-jwt/jwt/v5"
	"testing"
	"time"
	"umccare/clinical/internal/domain"
)

func TestJWTRejectsWrongSignatureAudienceExpiredAndMissingExpiry(t *testing.T) {
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	other, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	auth := NewJWT(&key.PublicKey, "identity-test", "umc-care-test")
	claims := Claims{ActorType: "DOCTOR", TokenVersion: 1, RegisteredClaims: jwt.RegisteredClaims{Subject: domain.NewID(), Issuer: "identity-test", Audience: jwt.ClaimStrings{"umc-care-test"}, IssuedAt: jwt.NewNumericDate(time.Now().Add(-time.Second)), ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute))}}
	sign := func(c Claims, k *rsa.PrivateKey) string {
		raw, err := jwt.NewWithClaims(jwt.SigningMethodRS256, c).SignedString(k)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	if p, err := auth.Authenticate(context.Background(), sign(claims, key)); err != nil || p.UserID != claims.Subject {
		t.Fatal(p, err)
	}
	expired := claims
	expired.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Minute))
	missing := claims
	missing.ExpiresAt = nil
	wrong := claims
	wrong.Audience = jwt.ClaimStrings{"other"}
	for _, raw := range []string{sign(claims, other), sign(expired, key), sign(missing, key), sign(wrong, key), "malformed"} {
		if _, err := auth.Authenticate(context.Background(), raw); domain.Code(err) != "UNAUTHENTICATED" {
			t.Fatal("untrusted token accepted", err)
		}
	}
	if _, err := NewJWT(nil, "", "").Authenticate(context.Background(), "anything"); domain.Code(err) != "SERVICE_UNAVAILABLE" {
		t.Fatal(err)
	}
}
