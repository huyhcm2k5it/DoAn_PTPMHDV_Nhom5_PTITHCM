package httpadapter

import (
	"context"
	"strconv"
	"strings"

	"github.com/labstack/echo/v5"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

func registerResults(e *echo.Echo, o Options) {
	app, ok := o.App.(ports.Results)
	if !ok {
		return
	}
	protect := func(c *echo.Context, action string) (domain.Principal, error) {
		h := strings.Fields(c.Request().Header.Get("Authorization"))
		if len(h) != 2 || !strings.EqualFold(h[0], "Bearer") {
			return domain.Principal{}, domain.Fail("UNAUTHENTICATED", "Bearer token required")
		}
		if o.Auth == nil {
			return domain.Principal{}, domain.Fail("SERVICE_UNAVAILABLE", "Identity unavailable")
		}
		p, err := o.Auth.Authenticate(c.Request().Context(), h[1])
		if err != nil {
			return p, err
		}
		if action == "DI-007" || action == "DI-010" {
			return p, nil
		}
		verifier, ok := o.Auth.(interface {
			LeasePrincipal(context.Context, string, domain.Principal, string) (domain.Principal, error)
		})
		if !ok {
			return p, domain.Fail("SERVICE_UNAVAILABLE", "Lease verifier unavailable")
		}
		return verifier.LeasePrincipal(c.Request().Context(), c.Request().Header.Get("X-Authorization-Lease"), p, action)
	}
	respond := func(c *echo.Context, status int, result domain.Result) error {
		return c.JSON(status, map[string]any{"data": map[string]any{"result": result}, "meta": map[string]string{"correlationId": correlation(c)}})
	}
	e.POST("/api/v1/diagnostic-orders/:orderId/results", func(c *echo.Context) error {
		p, err := protect(c, "DI-007")
		if err != nil {
			return err
		}
		var in domain.ResultCreateInput
		if err = decode(c, &in); err != nil {
			return err
		}
		result, err := app.CreateResult(c.Request().Context(), p, c.Param("orderId"), c.Request().Header.Get("Idempotency-Key"), in)
		if err != nil {
			return err
		}
		return respond(c, 201, result)
	})
	e.PUT("/api/v1/results/:resultId", func(c *echo.Context) error {
		p, err := protect(c, "DI-008")
		if err != nil {
			return err
		}
		var in domain.ResultUpdateInput
		if err = decode(c, &in); err != nil {
			return err
		}
		result, err := app.UpdateResult(c.Request().Context(), p, c.Param("resultId"), c.Request().Header.Get("Idempotency-Key"), in)
		if err != nil {
			return err
		}
		return respond(c, 200, result)
	})
	transition := func(action string, rework bool) echo.HandlerFunc {
		return func(c *echo.Context) error {
			p, err := protect(c, action)
			if err != nil {
				return err
			}
			var version int
			var reason string
			if rework {
				var in domain.ResultReworkInput
				if err = decode(c, &in); err != nil {
					return err
				}
				version, reason = in.ExpectedVersion, in.Reason
			} else {
				var in domain.ResultReviewInput
				if err = decode(c, &in); err != nil {
					return err
				}
				version = in.ExpectedVersion
			}
			result, err := app.TransitionResult(c.Request().Context(), p, c.Param("resultId"), c.Request().Header.Get("Idempotency-Key"), action, version, reason, domain.ResultMeta{CorrelationID: correlation(c)})
			if err != nil {
				return err
			}
			return respond(c, 200, result)
		}
	}
	e.POST("/api/v1/results/:resultId/submit-review", transition("DI-009", false))
	e.POST("/api/v1/results/:resultId/return-rework", transition("DI-010", true))
	e.POST("/api/v1/results/:resultId/publish", transition("DI-011", false))
	if cancel, ok := o.App.(ports.Cancellation); ok {
		e.POST("/api/v1/diagnostic-orders/:orderId/cancel", func(c *echo.Context) error {
			p, err := protect(c, "DI-012")
			if err != nil {
				return err
			}
			var in domain.CancelInput
			if err = decode(c, &in); err != nil {
				return err
			}
			data, err := cancel.CancelOrder(c.Request().Context(), p, c.Param("orderId"), c.Request().Header.Get("Idempotency-Key"), in, domain.ResultMeta{CorrelationID: correlation(c)})
			if err != nil {
				return err
			}
			return c.JSON(200, map[string]any{"data": data, "meta": map[string]string{"correlationId": correlation(c)}})
		})
	}
	if reader, ok := o.App.(ports.PublishedResultsReader); ok {
		e.GET("/api/v1/patients/:patientId/published-results", func(c *echo.Context) error {
			p, err := protect(c, "DI-013")
			if err != nil {
				return err
			}
			page, limit := 1, 20
			for name, values := range c.Request().URL.Query() {
				if len(values) != 1 || (name != "page" && name != "limit") {
					return domain.Fail("VALIDATION_ERROR", "Invalid query parameters")
				}
				n, parseErr := strconv.Atoi(values[0])
				if parseErr != nil || n < 1 {
					return domain.Fail("VALIDATION_ERROR", "Positive pagination required")
				}
				if name == "page" {
					page = n
				} else {
					limit = n
				}
			}
			out, err := reader.PublishedResults(c.Request().Context(), p, c.Param("patientId"), page, limit)
			if err != nil {
				return err
			}
			return c.JSON(200, map[string]any{"data": out, "meta": map[string]string{"correlationId": correlation(c)}})
		})
	}
}
