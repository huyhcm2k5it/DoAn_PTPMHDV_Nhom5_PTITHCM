package projection

import (
	"context"
	"encoding/json"
	"strings"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/domain"
)

type Versioned struct {
	Version int             `json:"version"`
	Value   json.RawMessage `json:"value"`
}

func canonical(v any) any {
	switch x := v.(type) {
	case map[string]any:
		r := map[string]any{}
		for k, v := range x {
			r[strings.ToLower(k)] = canonical(v)
		}
		return r
	case []any:
		for i := range x {
			x[i] = canonical(x[i])
		}
		return x
	}
	return v
}
func Hash(b []byte) string {
	var x any
	if json.Unmarshal(b, &x) != nil {
		return ""
	}
	return domain.Hash(canonical(x))
}
func Put(ctx context.Context, t ports.Tx, kind, key string, version int, value any) error {
	var prior Versioned
	b, e := json.Marshal(value)
	if e != nil {
		return e
	}
	raw, e := t.Get(ctx, "versions", kind+":"+key)
	if e != nil && domain.Code(e) != "NOT_FOUND" {
		return e
	}
	if e == nil {
		if json.Unmarshal(raw, &prior) != nil {
			return domain.Fail("SERVICE_UNAVAILABLE", "Invalid projection metadata")
		}
		if version < prior.Version {
			return nil
		}
		if version == prior.Version {
			if Hash(b) != Hash(prior.Value) {
				return domain.Fail("INVALID_MESSAGE", "Projection revision content conflict")
			}
			return nil
		}
	}
	if e = t.Put(ctx, "versions", kind+":"+key, Versioned{version, b}); e != nil {
		return e
	}
	return t.Put(ctx, kind, key, value)
}
