package httpadapter

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/labstack/echo/v5"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
)

type Config struct {
	Name  string
	Ready func(context.Context) error
}
type Authenticator interface {
	Authenticate(context.Context, string, string, bool) (domain.Principal, error)
}

var correlationPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,100}$`)

func New(cfg Config, app ports.Catalog, auth Authenticator) *echo.Echo {
	e := echo.New()
	e.HTTPErrorHandler = func(c *echo.Context, err error) {
		code := domain.Code(err)
		status := 503
		message := "Service temporarily unavailable"
		switch code {
		case "VALIDATION_ERROR":
			status = 400
		case "UNAUTHENTICATED":
			status = 401
		case "FORBIDDEN":
			status = 403
		case "OVERLAPPING_PRICE_PERIOD", "IDEMPOTENCY_CONFLICT":
			status = 409
		}
		var de *domain.Error
		if errors.As(err, &de) && status != 503 {
			message = de.Message
		}
		if n := echo.StatusCode(err); n == 404 || n == 405 {
			status = n
			if n == 404 {
				code = "NOT_FOUND"
				message = "Resource not found"
			} else {
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
					slog.Error("request panic recovered", "correlationId", id)
					err = domain.Fail("SERVICE_UNAVAILABLE", "Request could not be processed")
				}
			}()
			return next(c)
		}
	})
	e.GET("/health/live", func(c *echo.Context) error {
		return c.JSON(200, map[string]string{"service": cfg.Name, "status": "alive"})
	})
	e.GET("/health/ready", func(c *echo.Context) error {
		if cfg.Ready == nil {
			return domain.Fail("SERVICE_UNAVAILABLE", "Readiness is not configured")
		}
		if err := cfg.Ready(c.Request().Context()); err != nil {
			return err
		}
		return c.JSON(200, map[string]string{"service": cfg.Name, "status": "ready"})
	})
	if app == nil {
		return e
	}
	ok := func(c *echo.Context, value any, status int) error {
		return c.JSON(status, map[string]any{"data": value, "meta": map[string]string{"correlationId": correlation(c)}})
	}
	protected := func(c *echo.Context, lease bool) (domain.Principal, error) {
		fields := strings.Fields(c.Request().Header.Get("Authorization"))
		if len(fields) != 2 || !strings.EqualFold(fields[0], "Bearer") {
			return domain.Principal{}, domain.Fail("UNAUTHENTICATED", "Bearer token required")
		}
		if auth == nil {
			return domain.Principal{}, domain.Fail("SERVICE_UNAVAILABLE", "Identity verification is not configured")
		}
		return auth.Authenticate(c.Request().Context(), fields[1], c.Request().Header.Get("X-Authorization-Lease"), lease)
	}
	e.GET("/api/v1/departments", func(c *echo.Context) error {
		x, err := app.Departments(c.Request().Context())
		if err != nil {
			return err
		}
		return ok(c, map[string]any{"items": x}, 200)
	})
	e.GET("/api/v1/doctors", func(c *echo.Context) error {
		page, err := integer(c.QueryParam("page"), 1)
		if err != nil {
			return err
		}
		limit, err := integer(c.QueryParam("limit"), 20)
		if err != nil {
			return err
		}
		x, err := app.Doctors(c.Request().Context(), ports.DoctorQuery{DepartmentID: c.QueryParam("departmentId"), Page: page, Limit: limit})
		if err != nil {
			return err
		}
		return ok(c, x, 200)
	})
	e.GET("/api/v1/medical-services", func(c *echo.Context) error {
		q := ports.ServiceQuery{DepartmentID: c.QueryParam("departmentId")}
		if at := c.QueryParam("at"); at != "" {
			t, err := time.Parse(time.RFC3339Nano, at)
			if err != nil {
				return domain.Fail("VALIDATION_ERROR", "at must be an RFC3339 timestamp")
			}
			q.At = t
		}
		x, err := app.MedicalServices(c.Request().Context(), q)
		if err != nil {
			return err
		}
		return ok(c, map[string]any{"items": x}, 200)
	})
	e.GET("/api/v1/catalog/medicines", func(c *echo.Context) error {
		p, err := protected(c, false)
		if err != nil {
			return err
		}
		x, err := app.Medicines(c.Request().Context(), p, ports.SearchQuery{Q: c.QueryParam("q"), Status: c.QueryParam("status")})
		if err != nil {
			return err
		}
		return ok(c, x, 200)
	})
	e.GET("/api/v1/catalog/lab-tests", func(c *echo.Context) error {
		p, err := protected(c, false)
		if err != nil {
			return err
		}
		x, err := app.LabTests(c.Request().Context(), p, ports.SearchQuery{Q: c.QueryParam("q"), Status: c.QueryParam("status")})
		if err != nil {
			return err
		}
		return ok(c, x, 200)
	})
	e.POST("/api/v1/prices", func(c *echo.Context) error {
		p, err := protected(c, true)
		if err != nil {
			return err
		}
		var input domain.PriceInput
		if err = priceBody(c, &input); err != nil {
			return err
		}
		x, err := app.CreatePrice(c.Request().Context(), p, c.Request().Header.Get("Idempotency-Key"), input, ports.Meta{CorrelationID: correlation(c), RequestID: domain.NewID()})
		if err != nil {
			return err
		}
		return ok(c, x, 201)
	})
	return e
}
func correlation(c *echo.Context) string {
	if id, ok := c.Get("correlationId").(string); ok {
		return id
	}
	return domain.NewID()
}
func integer(raw string, defaultValue int) (int, error) {
	if raw == "" {
		return defaultValue, nil
	}
	i, err := strconv.Atoi(raw)
	if err != nil || i < 1 {
		return 0, domain.Fail("VALIDATION_ERROR", "Pagination must be a positive integer")
	}
	return i, nil
}
func priceBody(c *echo.Context, out *domain.PriceInput) error {
	content, _, err := mime.ParseMediaType(c.Request().Header.Get("Content-Type"))
	if err != nil || content != "application/json" {
		return domain.Fail("VALIDATION_ERROR", "Content-Type must be application/json")
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Response(), c.Request().Body, 64*1024))
	if err != nil {
		return domain.Fail("VALIDATION_ERROR", "Request body is too large")
	}
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(out) != nil {
		return domain.Fail("VALIDATION_ERROR", "Malformed price JSON or unknown fields")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return domain.Fail("VALIDATION_ERROR", "Only one JSON object is allowed")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(body, &fields) != nil {
		return domain.Fail("VALIDATION_ERROR", "JSON object required")
	}
	for _, field := range []string{"itemType", "itemId", "amountVnd", "effectiveFrom"} {
		if value, ok := fields[field]; !ok || string(value) == "null" {
			return domain.Fail("VALIDATION_ERROR", field+" is required")
		}
	}
	return nil
}
