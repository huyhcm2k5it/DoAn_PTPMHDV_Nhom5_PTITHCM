package ports

import (
	"context"
	"time"
)

// ReadCache stores authorized, derived responses only. It never grants access.
type ReadCache interface {
	Get(context.Context, string) ([]byte, bool, error)
	Set(context.Context, string, []byte, time.Duration) error
}

// RecordsVersion changes whenever the published/signed response data changes.
type RecordsVersion interface {
	RecordsCacheVersion(context.Context, string, string, time.Time) (string, error)
}
