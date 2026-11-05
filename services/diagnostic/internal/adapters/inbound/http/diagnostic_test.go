package httpadapter

import (
	"net/http/httptest"
	"testing"
)

func TestBusinessRoutesRequireAuthentication(t *testing.T) {
	s := New(nil, Options{})
	for _, p := range []string{"/api/v1/diagnostic-orders", "/api/v1/diagnostic-orders/11111111-0000-0000-0000-000000000001"} {
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("GET", p, nil))
		if w.Code != 401 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
