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

func TestSigningLease(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	auth := NewJWT(&key.PublicKey, "identity", "umc")
	p := domain.Principal{UserID: "11111111-0000-0000-0000-000000000001", TokenVersion: 1}
	for _, tc := range []struct {
		action   string
		duration time.Duration
		good     bool
	}{{"CL-010", 30 * time.Second, true}, {"CL-009", 30 * time.Second, false}, {"CL-010", time.Minute, false}} {
		now := time.Now()
		raw, _ := jwt.NewWithClaims(jwt.SigningMethodRS256, LeaseClaims{Action: tc.action, TokenVersion: 1, RegisteredClaims: jwt.RegisteredClaims{Subject: p.UserID, Issuer: "identity", Audience: jwt.ClaimStrings{"umc"}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(tc.duration))}}).SignedString(key)
		e := auth.VerifyLease(context.Background(), raw, p, "CL-010")
		if (e == nil) != tc.good {
			t.Fatal(tc, e)
		}
	}
}
