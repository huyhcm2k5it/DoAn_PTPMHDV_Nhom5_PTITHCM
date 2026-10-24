package config

import (
	"fmt"
	"os"
)

type Config struct{ Name, Address, DatabaseURL, JWTIssuer, JWTAudience, JWTKeyFile, LeaseKeyFile string }

func Load(name, address string) (Config, error) {
	c := Config{Name: name, Address: address, DatabaseURL: os.Getenv("DATABASE_URL"), JWTIssuer: os.Getenv("JWT_ISSUER"), JWTAudience: os.Getenv("JWT_AUDIENCE"), JWTKeyFile: os.Getenv("JWT_PUBLIC_KEY_FILE"), LeaseKeyFile: os.Getenv("LEASE_PUBLIC_KEY_FILE")}
	if a := os.Getenv("LISTEN_ADDR"); a != "" {
		c.Address = a
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL is required")
	}
	if c.JWTIssuer != "" || c.JWTAudience != "" || c.JWTKeyFile != "" {
		if c.JWTIssuer == "" || c.JWTAudience == "" || c.JWTKeyFile == "" {
			return c, fmt.Errorf("JWT_ISSUER, JWT_AUDIENCE and JWT_PUBLIC_KEY_FILE must be configured together")
		}
	}
	if c.LeaseKeyFile == "" {
		c.LeaseKeyFile = c.JWTKeyFile
	}
	return c, nil
}
