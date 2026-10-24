# MongoDB foundation tests

This is a standalone test package for the Mongo storage primitives of Patient, Appointment and Pharmacy. It does not configure the Go/Django services or the web/Android applications.

Requires Node.js 24.x. From the repository root, enter this package and run:

```powershell
cd tests/mongo
npm ci --ignore-scripts
npm run typecheck
npm test
```

The first test run downloads the official MongoDB 8.0.16 binary (Windows archive is approximately 756 MB). Subsequent runs reuse the cache. An optional `MONGOMS_DOWNLOAD_DIR` environment variable selects the cache directory. MongoDB runs as a temporary, authenticated, one-member replica set on loopback; no Docker daemon or existing database is used. The test fixture stops its own server and cleans its temporary data afterward.

`npm test` compiles and runs the current Mongo foundation suite, not an HTTP/E2E application suite. Storage bootstraps live in repository-root `services/{patient,appointment,pharmacy}/src/db/indexes.ts`; shared primitives live in repository-root `mongo/`. They establish required identities, selected numeric invariants and unique keys, not the complete validation/state machines for all 28 APIs. The transaction callback may be retried: perform only local database work inside it, pass the session to every operation, and publish external messages from a committed outbox afterward.

Bootstrap creates collections/indexes for a fresh owner database; incompatible existing collection options fail and require an explicit migration. It never drops data or silently rewrites an existing validator. `provisionOwnerUser` creates a first-time service user with `readWrite` on exactly its owner database; rotation/reconciliation of an existing user belongs to deployment tooling. Passwords are supplied by the caller and must come from the deployment secret configuration.

Availability/hold lookup indexes are ordinary indexes. No TTL index deletes holds, stock reservations, idempotency records or outbox evidence before their owning cleanup workflow has safely processed them. Schedule interval overlap still requires guarded domain logic; a `(doctorId, startAt)` lookup index does not by itself prevent overlap.

The test TypeScript configuration emits an ES-module copy of the owner source into this package’s `.test-build` folder and resolves the MongoDB driver from this package’s dependencies. It does not establish runtime dependencies or a build configuration for the future service applications; each service will own those when scaffolded.
