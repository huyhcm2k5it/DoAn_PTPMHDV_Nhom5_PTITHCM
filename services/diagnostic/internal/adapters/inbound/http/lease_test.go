package httpadapter

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"umccare/diagnostic/internal/domain"
)

func TestResultLeaseBindsSubjectActionVersionAndDuration(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	auth := NewJWT(&key.PublicKey, "identity", "umc")
	now := time.Now().UTC()
	p := domain.Principal{UserID: domain.NewID(), TokenVersion: 2}
	for _, tc := range []struct {
		name, action, subject string
		version               int
		duration              time.Duration
		valid                 bool
	}{
		{"valid", "DI-011", p.UserID, 2, 25 * time.Second, true},
		{"wrong action", "DI-010", p.UserID, 2, 25 * time.Second, false},
		{"wrong subject", "DI-011", domain.NewID(), 2, 25 * time.Second, false},
		{"revoked version", "DI-011", p.UserID, 1, 25 * time.Second, false},
		{"too long", "DI-011", p.UserID, 2, 31 * time.Second, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			claims := LeaseClaims{Action: tc.action, TokenVersion: tc.version, RegisteredClaims: jwt.RegisteredClaims{Subject: tc.subject, Issuer: "identity", Audience: jwt.ClaimStrings{"umc"}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(tc.duration))}}
			raw, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
			if err != nil {
				t.Fatal(err)
			}
			got, err := auth.LeasePrincipal(context.Background(), raw, p, "DI-011")
			if tc.valid {
				if err != nil || got.LeaseAction != "DI-011" || got.LeaseExpiresAt.IsZero() {
					t.Fatalf("valid lease rejected: %v", err)
				}
			} else if domain.Code(err) != "AUTHZ_LEASE_EXPIRED" {
				t.Fatalf("invalid lease accepted: %v", err)
			}
		})
	}
}
