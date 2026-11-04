package httpadapter

import (
	"context"
	"github.com/labstack/echo/v5"
	"strconv"
	"strings"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

func registerTreatment(e *echo.Echo, opts Options) {
	app, ok := opts.App.(ports.Treatment)
	if !ok {
		return
	}
	protect := func(c *echo.Context, action string) (domain.Principal, error) {
		h := strings.Fields(c.Request().Header.Get("Authorization"))
		if len(h) != 2 || !strings.EqualFold(h[0], "Bearer") {
			return domain.Principal{}, domain.Fail("UNAUTHENTICATED", "Bearer required")
		}
		if opts.Auth == nil {
			return domain.Principal{}, domain.Fail("SERVICE_UNAVAILABLE", "Identity unavailable")
		}
		p, err := opts.Auth.Authenticate(c.Request().Context(), h[1])
		if err != nil || action == "" {
			return p, err
		}
		verifier, ok := opts.Auth.(interface {
			LeasePrincipal(context.Context, string, domain.Principal, string) (domain.Principal, error)
		})
		if !ok {
			return p, domain.Fail("SERVICE_UNAVAILABLE", "Authorization lease verifier unavailable")
		}
		p, err = verifier.LeasePrincipal(c.Request().Context(), c.Request().Header.Get("X-Authorization-Lease"), p, action)
		if err == nil {
			p.LeaseAction = action
		}
		return p, err
	}
	respond := func(c *echo.Context, status int, data any) error {
		return c.JSON(status, map[string]any{"data": data, "meta": map[string]string{"correlationId": correlation(c)}})
	}
	meta := func(c *echo.Context) domain.Meta {
		return domain.Meta{CorrelationID: correlation(c), RequestID: domain.NewID()}
	}
	e.POST("/api/v1/visits/:visitId/lab-orders", func(c *echo.Context) error {
		p, err := protect(c, "")
		if err != nil {
			return err
		}
		var in domain.LabInput
		if err = decode(c, &in); err != nil {
			return err
		}
		out, err := app.RequestLab(c.Request().Context(), p, c.Param("visitId"), c.Request().Header.Get("Idempotency-Key"), in, meta(c))
		if err != nil {
			return err
		}
		c.Response().Header().Set("Location", out.StatusURL)
		return respond(c, 202, out)
	})
	e.POST("/api/v1/visits/:visitId/prescriptions", func(c *echo.Context) error {
		p, err := protect(c, "")
		if err != nil {
			return err
		}
		var in domain.PrescriptionInput
		if err = decode(c, &in); err != nil {
			return err
		}
		if in.ExpectedVersion != 0 {
			return domain.Fail("VALIDATION_ERROR", "expectedVersion is not accepted on create")
		}
		out, err := app.CreatePrescription(c.Request().Context(), p, c.Param("visitId"), c.Request().Header.Get("Idempotency-Key"), in)
		if err != nil {
			return err
		}
		return respond(c, 201, map[string]any{"prescription": out})
	})
	e.PUT("/api/v1/prescriptions/:prescriptionId", func(c *echo.Context) error {
		p, err := protect(c, "")
		if err != nil {
			return err
		}
		var in domain.PrescriptionInput
		if err = decode(c, &in); err != nil {
			return err
		}
		out, err := app.UpdatePrescription(c.Request().Context(), p, c.Param("prescriptionId"), c.Request().Header.Get("Idempotency-Key"), in)
		if err != nil {
			return err
		}
		return respond(c, 200, map[string]any{"prescription": out})
	})
	e.DELETE("/api/v1/prescriptions/:prescriptionId", func(c *echo.Context) error {
		p, err := protect(c, "")
		if err != nil {
			return err
		}
		q := c.Request().URL.Query()
		if len(q) != 1 || len(q["expectedVersion"]) != 1 {
			return domain.Fail("VALIDATION_ERROR", "Unique expectedVersion required")
		}
		n, err := strconv.Atoi(c.QueryParam("expectedVersion"))
		if err != nil {
			return domain.Fail("VALIDATION_ERROR", "Positive expectedVersion required")
		}
		out, err := app.DeletePrescription(c.Request().Context(), p, c.Param("prescriptionId"), c.Request().Header.Get("Idempotency-Key"), domain.VersionInput{ExpectedVersion: n})
		if err != nil {
			return err
		}
		return respond(c, 200, out)
	})
	e.POST("/api/v1/prescriptions/:prescriptionId/finalize", func(c *echo.Context) error {
		p, err := protect(c, "CL-009")
		if err != nil {
			return err
		}
		var in domain.VersionInput
		if err = decode(c, &in); err != nil {
			return err
		}
		out, err := app.FinalizePrescription(c.Request().Context(), p, c.Param("prescriptionId"), c.Request().Header.Get("Idempotency-Key"), in, meta(c))
		if err != nil {
			return err
		}
		return respond(c, 200, map[string]any{"prescription": out})
	})
	e.POST("/api/v1/visits/:visitId/complete", func(c *echo.Context) error {
		p, err := protect(c, "CL-010")
		if err != nil {
			return err
		}
		var in domain.VersionInput
		if err = decode(c, &in); err != nil {
			return err
		}
		out, err := app.Complete(c.Request().Context(), p, c.Param("visitId"), c.Request().Header.Get("Idempotency-Key"), in, meta(c))
		if err != nil {
			return err
		}
		return respond(c, 200, out)
	})
}
