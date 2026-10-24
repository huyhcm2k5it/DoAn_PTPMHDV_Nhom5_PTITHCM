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
	httpadapter "umccare/catalog/internal/adapters/inbound/http"
	"umccare/catalog/internal/adapters/outbound/postgres"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/application/usecase"
	"umccare/catalog/internal/config"
)

func key(path string) (*rsa.PublicKey, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return jwt.ParseRSAPublicKeyFromPEM(raw)
}
func main() {
	if err := run(); err != nil {
		slog.Error("catalog startup failed; verify configuration and dependencies")
		os.Exit(1)
	}
}
func run() error {
	cfg, err := config.Load("catalog", "127.0.0.1:8081")
	if err != nil {
		return err
	}
	db, err := postgres.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	var auth httpadapter.Authenticator
	if cfg.JWTKeyFile != "" {
		access, e := key(cfg.JWTKeyFile)
		if e != nil {
			return e
		}
		lease, e := key(cfg.LeaseKeyFile)
		if e != nil {
			return e
		}
		auth = httpadapter.NewJWT(access, lease, cfg.JWTIssuer, cfg.JWTAudience)
	}
	app := usecase.New(db, db, ports.RealClock{})
	handler := httpadapter.New(httpadapter.Config{Name: cfg.Name, Ready: db.Ready}, app, auth)
	server := &http.Server{Addr: cfg.Address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 * 1024}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan error, 1)
	go func() {
		slog.Info("catalog HTTP listening", "address", cfg.Address, "authConfigured", auth != nil)
		done <- server.ListenAndServe()
	}()
	select {
	case err = <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
