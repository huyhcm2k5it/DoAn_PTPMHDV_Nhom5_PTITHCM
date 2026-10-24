package httpadapter

import (
	"github.com/labstack/echo/v5"
	"umccare/diagnostic/internal/application/ports"
)

func New(p ports.Readiness) *echo.Echo {
	e := echo.New()
	e.GET("/health/live", func(c *echo.Context) error {
		return c.JSON(200, map[string]string{"service": "diagnostic", "status": "alive", "scope": "foundation-only"})
	})
	e.GET("/health/ready", func(c *echo.Context) error {
		if p == nil || p.Ready(c.Request().Context()) != nil {
			return c.JSON(503, map[string]string{"status": "not-ready", "code": "SERVICE_UNAVAILABLE"})
		}
		return c.JSON(200, map[string]string{"status": "ready", "scope": "database-connectivity-only"})
	})
	return e
}
