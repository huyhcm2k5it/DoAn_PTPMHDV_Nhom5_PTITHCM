# UMC Care

UMC Care uses nine independently owned services. The first implementation adds MongoDB storage constraints, isolated service credentials, and transaction contract tests for Quan’s three services. HTTP endpoints and the full application runtime are subsequent tasks.

## Structure and ownership

- `apps/web/`: React + TypeScript. Quan owns the shell, routes, and shared UI; feature ownership follows the corresponding service.
- `apps/android/`: Kotlin + Jetpack Compose; Hung owns Android PATIENT.
- `services/`: Nine independent services: Quan - Patient, Appointment, Pharmacy; Huy - Catalog, Clinical, Diagnostic; Hung - Identity, Billing, Notification.
- `contracts/`: HTTP and message contracts.
- `infra/compose/`: Docker Compose configuration.
- `envoy/`, `rabbitmq/`, `mongo/`, `postgres/`: Root-level configuration for the gateway and data services, as shown in the directory diagram.
- `tests/`: E2E and performance tests.
- `docs/`: Project documentation.
- `.github/workflows/`: CI.

Each service owns its database, migrations, tests, and workers. A service must not access another service's database directly. Add or change files only within the appropriate owner's scope, and update the README if that scope changes.

## MongoDB foundation tests

Requires Node.js 24.x. Install the pinned dependencies and run:

```powershell
npm ci --ignore-scripts
npm run typecheck
npm test
```

The first test run downloads the official MongoDB 8.0.16 binary (Windows archive is approximately 756 MB). Subsequent runs reuse the cache. An optional `MONGOMS_DOWNLOAD_DIR` environment variable selects the cache directory. MongoDB runs as a temporary, authenticated, one-member replica set on loopback; no Docker daemon or existing database is used. The test fixture stops its own server and cleans its temporary data afterward.

`npm test` compiles and runs the current Mongo foundation suite, not an HTTP/E2E application suite. Storage bootstraps live in `services/{patient,appointment,pharmacy}/src/db/indexes.ts`; shared primitives live in `mongo/`. They establish required identities, selected numeric invariants and unique keys, not the complete validation/state machines for all 28 APIs. The transaction callback may be retried: perform only local database work inside it, pass the session to every operation, and publish external messages from a committed outbox afterward.

Bootstrap creates collections/indexes for a fresh owner database; incompatible existing collection options fail and require an explicit migration. It never drops data or silently rewrites an existing validator. `provisionOwnerUser` creates a first-time service user with `readWrite` on exactly its owner database; rotation/reconciliation of an existing user belongs to deployment tooling. Passwords are supplied by the caller and must come from the deployment secret configuration.

Availability/hold lookup indexes are ordinary indexes. No TTL index deletes holds, stock reservations, idempotency records or outbox evidence before their owning cleanup workflow has safely processed them. Schedule interval overlap still requires guarded domain logic; a `(doctorId, startAt)` lookup index does not by itself prevent overlap.
