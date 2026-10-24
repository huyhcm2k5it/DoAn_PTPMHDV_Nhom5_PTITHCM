# diagnostic

Owner: Huy. Go + Echo + Hexagonal + pgx.

Week 1 foundation only: module, HTTP process, PostgreSQL readiness and shutdown. No visit/LAB business endpoints are implemented yet.

Set DATABASE_URL and optionally LISTEN_ADDR (default 127.0.0.1:8083). Run go run ./cmd/api, go test ./..., go vet ./... and go build ./....

GET /health/live checks the process. GET /health/ready checks the service own database connection; this does not certify future business migrations or message projections.

Core: internal/application/ports + health. Echo and pgx are adapters. Composition lives in cmd/api. No code/DB import from another service. Integration via Envoy belongs to Hung and comes later.
