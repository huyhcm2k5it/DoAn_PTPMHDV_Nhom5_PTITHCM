package migrations

import "embed"

// Files contains schema migrations only. Test fixtures are not bundled in binaries.
//
//go:embed *.sql
var Files embed.FS
