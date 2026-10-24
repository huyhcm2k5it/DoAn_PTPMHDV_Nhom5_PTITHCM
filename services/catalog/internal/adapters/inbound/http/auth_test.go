package httpadapter

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"github.com/golang-jwt/jwt/v5"
	"testing"
	"time"
	"umccare/catalog/internal/domain"
)

func TestJWTAndLeaseVerification(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	auth := NewJWT(&key.PublicKey, &key.PublicKey, "issuer", "catalog")
	now := time.Now().UTC()
	id := domain.NewID()
	access := Claims{ActorType: "STAFF", Capabilities: []string{"ADMIN"}, TokenVersion: 1, RegisteredClaims: jwt.RegisteredClaims{Subject: id, Issuer: "issuer", Audience: []string{"catalog"}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Minute))}}
	token, _ := jwt.NewWithClaims(jwt.SigningMethodRS256, access).SignedString(key)
	lease := Claims{Action: "CA-004", TokenVersion: 1, RegisteredClaims: jwt.RegisteredClaims{Subject: id, Issuer: "issuer", Audience: []string{"catalog"}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(30 * time.Second))}}
	signed, _ := jwt.NewWithClaims(jwt.SigningMethodRS256, lease).SignedString(key)
	if _, e := auth.Authenticate(context.Background(), token, "", true); domain.Code(e) != "FORBIDDEN" {
		t.Fatal(e)
	}
	p, e := auth.Authenticate(context.Background(), token, signed, true)
	if e != nil || p.LeaseAction != "CA-004" {
		t.Fatal(p, e)
	}
	lease.ExpiresAt = jwt.NewNumericDate(now.Add(time.Minute))
	long, _ := jwt.NewWithClaims(jwt.SigningMethodRS256, lease).SignedString(key)
	if _, e = auth.Authenticate(context.Background(), token, long, true); domain.Code(e) != "FORBIDDEN" {
		t.Fatal("long lease accepted", e)
	}
	invalid, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": id}).SignedString([]byte("secret"))
	if _, e = auth.Authenticate(context.Background(), invalid, "", false); domain.Code(e) != "UNAUTHENTICATED" {
		t.Fatal(e)
	}
}
