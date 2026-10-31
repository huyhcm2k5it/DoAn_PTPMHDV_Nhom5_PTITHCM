package httpadapter

import (
	"context"
	"errors"
	"github.com/labstack/echo/v5"
	"log/slog"
	"net/http"
	"regexp"
	"time"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

type Authenticator interface {
	Authenticate(context.Context, string) (domain.Principal, error)
}
type Options struct {
	App   ports.Clinical
	Auth  Authenticator
	Ready func(context.Context) error
}

var correlationPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

func New(p ports.Readiness, options ...Options) *echo.Echo {
	e := echo.New()
	var opts Options
	if len(options) > 0 {
		opts = options[0]
	}
	e.HTTPErrorHandler = func(c *echo.Context, err error) {
		code := domain.Code(err)
		status := http.StatusServiceUnavailable
		message := "Service temporarily unavailable"
		switch code {
		case "VALIDATION_ERROR":
			status = 400
		case "UNAUTHENTICATED":
			status = 401
		case "FORBIDDEN":
			status = 403
		case "NOT_FOUND", "START_REQUEST_NOT_FOUND":
			status = 404
		case "IDEMPOTENCY_CONFLICT", "TICKET_VERSION_CONFLICT", "TICKET_ALREADY_CLAIMED", "VISIT_VERSION_CONFLICT", "VISIT_ALREADY_SIGNED":
			status = 409
		}
		var de *domain.Error
		if errors.As(err, &de) && status != 503 {
			message = de.Message
		}
		if n := echo.StatusCode(err); n == 404 || n == 405 {
			status = n
			code = "NOT_FOUND"
			message = "Resource not found"
			if n == 405 {
				code = "METHOD_NOT_ALLOWED"
				message = "Method not allowed"
			}
		}
		_ = c.JSON(status, map[string]any{"error": map[string]string{"code": code, "message": message}, "meta": map[string]string{"correlationId": correlation(c)}})
	}
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) (err error) {
			id := c.Request().Header.Get("X-Correlation-ID")
			if !correlationPattern.MatchString(id) {
				id = domain.NewID()
			}
			c.Set("correlationId", id)
			c.Response().Header().Set("X-Correlation-ID", id)
			c.Response().Header().Set("Cache-Control", "no-store")
			ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
			defer cancel()
			c.SetRequest(c.Request().WithContext(ctx))
			defer func() {
				if recover() != nil {
					slog.Error("clinical request panic", "correlationId", id)
					err = domain.Fail("SERVICE_UNAVAILABLE", "Request could not be processed")
				}
				slog.Info("clinical request completed", "route", c.Path(), "correlationId", id, "errorCode", domain.Code(err))
			}()
			return next(c)
		}
	})
	e.GET("/health/live", func(c *echo.Context) error {
		scope := "foundation-only"
		if opts.App != nil {
			scope = "clinical-week2"
		}
		return c.JSON(200, map[string]string{"service": "clinical", "status": "alive", "scope": scope})
	})
	e.GET("/health/ready", func(c *echo.Context) error {
		ready := opts.Ready
		if ready == nil && p != nil {
			ready = p.Ready
		}
		if ready == nil || ready(c.Request().Context()) != nil {
			return c.JSON(503, map[string]string{"status": "not-ready", "code": "SERVICE_UNAVAILABLE"})
		}
		scope := "database-connectivity-only"
		if opts.Ready != nil {
			scope = "clinical-schema-only"
		}
		return c.JSON(200, map[string]string{"status": "ready", "scope": scope})
	})
	if opts.App != nil {
		registerClinical(e, opts)
	}
	return e
}

func correlation(c *echo.Context) string {
	if v, ok := c.Get("correlationId").(string); ok {
		return v
	}
	return domain.NewID()
}
