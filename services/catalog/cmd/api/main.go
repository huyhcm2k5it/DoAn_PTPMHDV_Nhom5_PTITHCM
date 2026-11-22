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
	"strings"
	"syscall"
	"time"
	httpadapter "umccare/catalog/internal/adapters/inbound/http"
	"umccare/catalog/internal/adapters/outbound/postgres"
	redisadapter "umccare/catalog/internal/adapters/outbound/redis"
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
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		if !healthy() {
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		slog.Error("catalog startup failed; verify configuration and dependencies")
		os.Exit(1)
	}
}
func run() error {
	cfg, err := config.Load("catalog", "127.0.0.1:8007")
	if err != nil {
		return err
	}
	db, err := postgres.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	if os.Getenv("MIGRATE_ON_START") == "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		err := db.Migrate(ctx)
		cancel()
		if err != nil {
			return err
		}
	}

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
	var cache ports.ReadCache
	if cfg.RedisURL != "" || cfg.RedisAddr != "" {
		var redisCache *redisadapter.Cache
		var cacheErr error
		if cfg.RedisURL != "" {
			redisCache, cacheErr = redisadapter.NewFromURL(cfg.RedisURL)
		} else {
			redisCache, cacheErr = redisadapter.New(cfg.RedisAddr, cfg.RedisUsername, cfg.RedisPassword)
		}
		if cacheErr != nil {
			return cacheErr
		}
		defer redisCache.Close()
		cache = redisCache
	}
	app := usecase.NewCached(db, db, ports.RealClock{}, cache, 10)
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

// Reuse the application binary for container readiness; no shell or curl image is needed.
func healthy() bool {
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:8007"
	}
	if strings.HasPrefix(address, ":") {
		address = "127.0.0.1" + address
	}
	if strings.HasPrefix(address, "0.0.0.0:") {
		address = "127.0.0.1:" + strings.TrimPrefix(address, "0.0.0.0:")
	}
	client := http.Client{Timeout: 2 * time.Second}
	response, err := client.Get("http://" + address + "/health/ready")
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode == http.StatusOK
}
