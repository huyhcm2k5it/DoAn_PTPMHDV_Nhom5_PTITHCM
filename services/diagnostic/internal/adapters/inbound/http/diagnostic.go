package httpadapter

import (
	"encoding/json"
	"github.com/labstack/echo/v5"
	"io"
	"net/http"
	"strconv"
	"strings"
	"umccare/diagnostic/internal/domain"
)

func decode(c *echo.Context, target any) error {
	if !strings.HasPrefix(strings.ToLower(c.Request().Header.Get("Content-Type")), "application/json") {
		return domain.Fail("VALIDATION_ERROR", "Content-Type application/json required")
	}
	d := json.NewDecoder(http.MaxBytesReader(c.Response(), c.Request().Body, 64<<10))
	d.DisallowUnknownFields()
	if d.Decode(target) != nil {
		return domain.Fail("VALIDATION_ERROR", "Malformed or unknown JSON fields")
	}
	var x any
	if d.Decode(&x) != io.EOF {
		return domain.Fail("VALIDATION_ERROR", "Exactly one JSON object required")
	}
	return nil
}
func registerDiagnostic(e *echo.Echo, o Options) {
	auth := func(c *echo.Context) (domain.Principal, error) {
		h := strings.Fields(c.Request().Header.Get("Authorization"))
		if len(h) != 2 || !strings.EqualFold(h[0], "Bearer") {
			return domain.Principal{}, domain.Fail("UNAUTHENTICATED", "Bearer token required")
		}
		if o.Auth == nil || o.App == nil {
			return domain.Principal{}, domain.Fail("SERVICE_UNAVAILABLE", "Identity and application configuration required")
		}
		return o.Auth.Authenticate(c.Request().Context(), h[1])
	}
	ok := func(c *echo.Context, status int, data any) error {
		return c.JSON(status, map[string]any{"data": data, "meta": map[string]string{"correlationId": correlation(c)}})
	}
	e.GET("/api/v1/diagnostic-orders", func(c *echo.Context) error {
		p, err := auth(c)
		if err != nil {
			return err
		}
		q := domain.Query{Page: 1, Limit: 20, State: c.QueryParam("state")}
		for name, values := range c.Request().URL.Query() {
			if len(values) != 1 {
				return domain.Fail("VALIDATION_ERROR", "Unique query fields required")
			}
			switch name {
			case "state":
			case "page", "limit":
				n, er := strconv.Atoi(values[0])
				if er != nil {
					return domain.Fail("VALIDATION_ERROR", "Integer pagination required")
				}
				if name == "page" {
					q.Page = n
				} else {
					q.Limit = n
				}
			default:
				return domain.Fail("VALIDATION_ERROR", "Unknown query parameter")
			}
		}
		out, err := o.App.List(c.Request().Context(), p, q)
		if err != nil {
			return err
		}
		return ok(c, 200, out)
	})
	e.GET("/api/v1/diagnostic-orders/:orderId", func(c *echo.Context) error {
		p, err := auth(c)
		if err != nil {
			return err
		}
		if len(c.Request().URL.Query()) != 0 {
			return domain.Fail("VALIDATION_ERROR", "Unknown query parameter")
		}
		out, err := o.App.Detail(c.Request().Context(), p, c.Param("orderId"))
		if err != nil {
			return err
		}
		return ok(c, 200, out)
	})
	for _, route := range []struct {
		path      string
		recollect bool
	}{{"/api/v1/diagnostic-orders/:orderId/specimens", false}, {"/api/v1/diagnostic-orders/:orderId/recollect", true}} {
		route := route
		e.POST(route.path, func(c *echo.Context) error {
			p, err := auth(c)
			if err != nil {
				return err
			}
			var in domain.SampleInput
			if err = decode(c, &in); err != nil {
				return err
			}
			out, err := o.App.Sample(c.Request().Context(), p, c.Param("orderId"), c.Request().Header.Get("Idempotency-Key"), in, route.recollect)
			if err != nil {
				return err
			}
			return ok(c, 201, map[string]any{"specimen": out})
		})
	}
	e.POST("/api/v1/specimens/:specimenId/reject", func(c *echo.Context) error {
		p, err := auth(c)
		if err != nil {
			return err
		}
		var in domain.RejectInput
		if err = decode(c, &in); err != nil {
			return err
		}
		out, err := o.App.Reject(c.Request().Context(), p, c.Param("specimenId"), c.Request().Header.Get("Idempotency-Key"), in)
		if err != nil {
			return err
		}
		return ok(c, 200, map[string]any{"specimen": out})
	})
}
