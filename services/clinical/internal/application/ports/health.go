package ports

import "context"

type Readiness interface{ Ready(context.Context) error }
