package httpadapter

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

type probe struct{ err error }

func (p probe) Ready(context.Context) error { return p.err }
func TestHealthIsNotBusinessImplementation(t *testing.T) {
	for _, ready := range []bool{false, true} {
		var err error
		if !ready {
			err = errors.New("private database details")
		}
		e := New(probe{err})
		w := httptest.NewRecorder()
		e.ServeHTTP(w, httptest.NewRequest("GET", "/health/live", nil))
		if w.Code != 200 {
			t.Fatal(w.Code)
		}
		w = httptest.NewRecorder()
		e.ServeHTTP(w, httptest.NewRequest("GET", "/health/ready", nil))
		expected := 503
		if ready {
			expected = 200
		}
		if w.Code != expected || strings.Contains(w.Body.String(), "private") {
			t.Fatal(w.Code, w.Body.String())
		}
		w = httptest.NewRecorder()
		e.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/diagnostic-orders", nil))
		if w.Code != 404 {
			t.Fatal("unfinished business endpoint exposed")
		}
	}
}
