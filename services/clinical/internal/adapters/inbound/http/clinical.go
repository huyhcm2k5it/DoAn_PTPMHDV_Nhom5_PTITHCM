package httpadapter

import (
	"encoding/json"
	"github.com/labstack/echo/v5"
	"io"
	"net/http"
	"strconv"
	"strings"
	"umccare/clinical/internal/domain"
)

func decode(c *echo.Context, target any) error {
	if !strings.HasPrefix(strings.ToLower(c.Request().Header.Get("Content-Type")), "application/json") {
		return domain.Fail("VALIDATION_ERROR", "Content-Type application/json required")
	}
	decoder := json.NewDecoder(http.MaxBytesReader(c.Response(), c.Request().Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return domain.Fail("VALIDATION_ERROR", "Malformed or unknown JSON fields")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return domain.Fail("VALIDATION_ERROR", "Exactly one JSON object required")
	}
	return nil
}
func registerClinical(e *echo.Echo, opts Options) {
	protect := func(c *echo.Context) (domain.Principal, error) {
		h := strings.Fields(c.Request().Header.Get("Authorization"))
		if len(h) != 2 || !strings.EqualFold(h[0], "Bearer") {
			return domain.Principal{}, domain.Fail("UNAUTHENTICATED", "Bearer token required")
		}
		if opts.Auth == nil {
			return domain.Principal{}, domain.Fail("SERVICE_UNAVAILABLE", "Identity verification is not configured")
		}
		return opts.Auth.Authenticate(c.Request().Context(), h[1])
	}
	ok := func(c *echo.Context, status int, data any) error {
		return c.JSON(status, map[string]any{"data": data, "meta": map[string]string{"correlationId": correlation(c)}})
	}
	e.GET("/api/v1/clinical/worklist", func(c *echo.Context) error {
		p, err := protect(c)
		if err != nil {
			return err
		}
		q := domain.WorklistQuery{Date: c.QueryParam("date"), State: c.QueryParam("state"), OperationID: c.QueryParam("operationId"), Page: 1, Limit: 20}
		for name, values := range c.Request().URL.Query() {
			if len(values) != 1 {
				return domain.Fail("VALIDATION_ERROR", "Query parameters must be unique")
			}
			switch name {
			case "page", "limit":
				n, e := strconv.Atoi(values[0])
				if e != nil || n < 1 {
					return domain.Fail("VALIDATION_ERROR", "Positive pagination required")
				}
				if name == "page" {
					q.Page = n
				} else {
					q.Limit = n
				}
			case "date", "state", "operationId":
			default:
				return domain.Fail("VALIDATION_ERROR", "Unknown query parameter")
			}
		}
		if err = q.Validate(); err != nil {
			return err
		}
		data, err := opts.App.Worklist(c.Request().Context(), p, q)
		if err != nil {
			return err
		}
		return ok(c, 200, data)
	})
	e.POST("/api/v1/visits/start", func(c *echo.Context) error {
		p, err := protect(c)
		if err != nil {
			return err
		}
		var input domain.StartInput
		if err = decode(c, &input); err != nil {
			return err
		}
		if err = input.Validate(); err != nil {
			return err
		}
		key := c.Request().Header.Get("Idempotency-Key")
		if !domain.ValidID(key) {
			return domain.Fail("VALIDATION_ERROR", "UUID Idempotency-Key required")
		}
		data, err := opts.App.Start(c.Request().Context(), p, key, input, domain.Meta{CorrelationID: correlation(c), RequestID: domain.NewID()})
		if err != nil {
			return err
		}
		c.Response().Header().Set("Location", data.StatusURL)
		return ok(c, 202, data)
	})
	e.GET("/api/v1/visits/:visitId", func(c *echo.Context) error {
		p, err := protect(c)
		if err != nil {
			return err
		}
		if !domain.ValidID(c.Param("visitId")) {
			return domain.Fail("VALIDATION_ERROR", "UUID visitId required")
		}
		data, err := opts.App.Detail(c.Request().Context(), p, c.Param("visitId"))
		if err != nil {
			return err
		}
		return ok(c, 200, data)
	})
	e.PUT("/api/v1/visits/:visitId/draft", func(c *echo.Context) error {
		p, err := protect(c)
		if err != nil {
			return err
		}
		var input domain.DraftInput
		if err = decode(c, &input); err != nil {
			return err
		}
		if err = input.Validate(); err != nil {
			return err
		}
		key := c.Request().Header.Get("Idempotency-Key")
		if !domain.ValidID(key) || !domain.ValidID(c.Param("visitId")) {
			return domain.Fail("VALIDATION_ERROR", "UUID visitId and Idempotency-Key required")
		}
		data, err := opts.App.SaveDraft(c.Request().Context(), p, c.Param("visitId"), key, input)
		if err != nil {
			return err
		}
		return ok(c, 200, data)
	})
}
