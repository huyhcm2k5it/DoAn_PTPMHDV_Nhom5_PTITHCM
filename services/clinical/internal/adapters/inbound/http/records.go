package httpadapter

import (
	"context"
	"strconv"
	"strings"

	"github.com/labstack/echo/v5"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

func registerRecords(e *echo.Echo, opts Options) {
	app, ok := opts.App.(ports.MedicalRecords)
	if !ok {
		return
	}
	e.GET("/api/v1/patients/:patientId/medical-records", func(c *echo.Context) error {
		h := strings.Fields(c.Request().Header.Get("Authorization"))
		if len(h) != 2 || !strings.EqualFold(h[0], "Bearer") {
			return domain.Fail("UNAUTHENTICATED", "Bearer required")
		}
		if opts.Auth == nil {
			return domain.Fail("SERVICE_UNAVAILABLE", "Identity unavailable")
		}
		p, err := opts.Auth.Authenticate(c.Request().Context(), h[1])
		if err != nil {
			return err
		}
		verifier, ok := opts.Auth.(interface {
			LeasePrincipal(context.Context, string, domain.Principal, string) (domain.Principal, error)
		})
		if !ok {
			return domain.Fail("SERVICE_UNAVAILABLE", "Authorization lease verifier unavailable")
		}
		p, err = verifier.LeasePrincipal(c.Request().Context(), c.Request().Header.Get("X-Authorization-Lease"), p, "CL-011")
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
		out, err := app.Records(c.Request().Context(), p, c.Param("patientId"), page, limit)
		if err != nil {
			return err
		}
		return c.JSON(200, map[string]any{"data": out, "meta": map[string]string{"correlationId": correlation(c)}})
	})
}
