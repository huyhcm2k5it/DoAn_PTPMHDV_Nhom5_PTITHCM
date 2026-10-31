package main

import (
	"context"
	"crypto/rsa"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	httpadapter "umccare/clinical/internal/adapters/inbound/http"
	"umccare/clinical/internal/adapters/outbound/postgres"
	"umccare/clinical/internal/application/health"
	"umccare/clinical/internal/application/usecase"
)

func main() {
	if e := run(); e != nil {
		slog.Error("clinical startup failed; verify DATABASE_URL and listen address")
		os.Exit(1)
	}
}
func run() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL required")
	}
	db, e := postgres.New(context.Background(), dsn)
	if e != nil {
		return e
	}
	defer db.Close()
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8082"
	}
	issuer, audience, keyPath := os.Getenv("JWT_ISSUER"), os.Getenv("JWT_AUDIENCE"), os.Getenv("JWT_PUBLIC_KEY_FILE")
	var key *rsa.PublicKey
	if issuer != "" || audience != "" || keyPath != "" {
		if issuer == "" || audience == "" || keyPath == "" {
			return errors.New("JWT issuer, audience and key must be configured together")
		}
		raw, err := os.ReadFile(keyPath)
		if err != nil {
			return errors.New("cannot load JWT public key")
		}
		key, err = jwt.ParseRSAPublicKeyFromPEM(raw)
		if err != nil {
			return errors.New("invalid RSA public key")
		}
	}
	server := &http.Server{Addr: addr, Handler: httpadapter.New(health.New(db), httpadapter.Options{App: usecase.New(db, time.Now), Auth: httpadapter.NewJWT(key, issuer, audience), Ready: db.BusinessReady}), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	select {
	case e = <-done:
		if errors.Is(e, http.ErrServerClosed) {
			return nil
		}
		return e
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
