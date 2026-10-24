# MongoDB foundation tests

This standalone JavaScript/CommonJS package verifies the Mongo storage primitives owned by Patient, Appointment and Pharmacy through Mongoose connections. The Node backend choice is Express + Mongoose + JavaScript, using `require` and `module.exports`. Express routes/controllers and application models belong to the next service-scaffolding task.

Requires Node.js 24.x. From the repository root:

```powershell
cd tests/mongo
npm ci --ignore-scripts
npm run check
npm test
```

There is no TypeScript compiler/build step for this package. `npm run check` checks JavaScript syntax; `npm test` runs the tests directly. Storage bootstrap functions live in `services/{patient,appointment,pharmacy}/src/db/indexes.js` and accept an open Mongoose connection. Shared primitives live in repository-root `mongo/`. This test package owns Mongoose for the harness; each service will declare its own Express/Mongoose dependencies when scaffolded.

The first run downloads the official MongoDB 8.0.16 binary (approximately 756 MB on Windows); later runs reuse the cache. `MONGOMS_DOWNLOAD_DIR` optionally selects the cache directory. Tests start a temporary, authenticated, one-member WiredTiger replica set on loopback, and stop it with its temporary data afterward. No existing database or Docker Engine is used.

The suite covers business-key uniqueness, selected database-level ownership/numeric validators, local transaction rollback with outbox, guarded slot races, all-item stock rollback, and database ownership credentials. These are foundation contracts; they do not establish completed HTTP endpoints or application E2E workflows. Raw collection operations intentionally test that database constraints cannot be bypassed by omitting ODM validation. A Mongoose document regression additionally verifies that abort resets document state and allows retry.

`withMongoTransaction(connection, callback)` delegates to Mongoose `connection.transaction()`, preserving Mongoose document change tracking on rollback. The callback may run again: pass its session to each operation, use sequential database operations, and publish external messages only after commit through the outbox. Models should be bound to their owner connection; avoid a shared default model connection across services.

Bootstrap creates collections/indexes for a fresh owner database; incompatible existing options fail and need an explicit migration. It does not drop data or silently overwrite validators. The current validators guard selected storage invariants, not every API field or state transition. `provisionOwnerUser` creates a first-time readWrite user for exactly one owner DB; deployment tooling owns secret validation, rotation and reconciliation.

Expiry indexes are ordinary indexes. A cleanup workflow must safely release capacity/stock and respect settlement locks before removing records. The schedule lookup index alone does not prevent interval overlap; guarded domain operations remain required.
