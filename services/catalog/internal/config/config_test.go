package config

import (
	"testing"
)

func TestConfigRequiresDatabase(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if _, e := Load("catalog", "127.0.0.1:8081"); e == nil {
		t.Fatal("missing database accepted")
	}
	t.Setenv("DATABASE_URL", "postgres://local/test")
	c, e := Load("catalog", "127.0.0.1:8081")
	if e != nil || c.Address != "127.0.0.1:8081" {
		t.Fatal(c, e)
	}
	t.Setenv("JWT_ISSUER", "issuer")
	if _, e = Load("catalog", "x"); e == nil {
		t.Fatal("partial auth config accepted")
	}
}
