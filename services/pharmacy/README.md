# Pharmacy service

Owner: Quân. Node.js 24, Express 5, Mongoose 9, JavaScript CommonJS.

## Implemented

- PH-001..008: stock/receipts, FINAL prescription queue/detail, atomic full-prescription hold,
  release/expiry/rehold, local settlement reconcile and single dispense.
- Separate patient owner status DTO, staff PHARMACY guard, current Identity/Patient projections,
  bearer verification and Identity authorization lease PH002..PH008.
- One stable hold per prescription/revision; attemptNo/history separates retries.
  Reserve stock at HELD, retain through COMMITTED, decrement onHand/reserved only at DISPENSED.
- Fenced payment evidence, FAILED tombstones, UNKNOWN lock retention, inbox/outbox,
  mandatory confirms and database retry_jobs/quarantine.
- Owner-only pharmacy_db URI, additive index bootstrap/migration, insert-only inventory seed,
  readiness and graceful shutdown.

## Run with online dependencies

```powershell
npm ci
npm run check
npm test
npm start
# separate terminal/process with the same owner Mongo URI and broker URL
npm run worker
```

Set MONGODB_URI to Quân's Atlas `pharmacy_db`, JWT_PUBLIC_KEY_FILE, JWT_ISSUER,
JWT_AUDIENCE; worker also needs AMQP_URL set to Quân's shared CloudAMQP URL. Do not put secrets in source.
Starting only HTTP does not publish outbox or run expiry/reconciliation.

PH002..PH008 require X-Authorization-Lease, action PH002..PH008 respectively, <=30s,
matching bearer sub/tokenVersion. Mutations also require UUID Idempotency-Key.
Use a new key for a new intent; retry the same intent/body with its original key.

HTTP contract: [pharmacy.openapi.json](../../contracts/http/pharmacy.openapi.json).
Business/API/schema/concurrency tests are under tests/mongo at repository root.
The package's own npm test is the small health/worker-routing suite, not the full business suite.

Setup, safe migration, seed and queue migration: [Compose README](../../infra/compose/README.md).
Contract/routing/expected results, local evidence and pending owner integration:
[week 4 handoff](../../docs/ban-giao-umc-care/quan-week4-pharmacy.md).

Status: locally verified implementation awaiting actual producer/receiver, broker,
Gateway/Identity and full Billing integration. No PAID/FINAL fixtures should be imported
into the shared runtime as acceptance evidence.
