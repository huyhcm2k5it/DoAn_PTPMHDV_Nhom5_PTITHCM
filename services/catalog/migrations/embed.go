package migrations

import "embed"

// Files contains the ordered schema and explicit opt-in demo seed.
//
//go:embed *.sql
var Files embed.FS
