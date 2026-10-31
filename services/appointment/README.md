# Appointment service

Owner: Quân. Runtime: Node.js 24, Express 5, Mongoose 9 and JavaScript CommonJS.

## Implemented

- GET /health/live and GET /health/ready.
- Public GET /api/v1/slots/available with UUID/date validation, an Asia/Ho_Chi_Minh day window, schedule filtering and remaining-capacity calculation.
- Owner-only Mongo URI guard and the appointment_db storage/index bootstrap.
- AP-008/AP-009 transactional holds with 10-minute expiry, patient overlap protection, idempotency and single-release capacity CAS.
- AP-010/AP-011/AP-012 booking, detail and patient-list APIs. AP-010 returns `202 PENDING_PAYMENT` and writes `RequestCharge` to outbox in the same transaction; booking fails closed when the Catalog price snapshot is missing or stale.
- Fail-closed auth dependency injection plus local access projections for Identity/Patient policy versions.
- Outbox publisher, Billing event consumer and settlement fence checks. Runtime AMQP wiring remains a handoff dependency.

## Local week-2 verification

```powershell
npm ci
npm run check
npm test
npm run seed:dry-run
npm run test:integration
```

`test:integration` starts an isolated Mongo replica set through `tests/mongo/booking.test.js`; it is local evidence for transactions and message guards, not Gate 2 evidence. `MONGODB_URI` must select `appointment_db` for `seed:demo` and `expire:holds`. The demo seed is repeatable and only upserts the allowlisted schedule/slot IDs.

The RabbitMQ proposal is in `/rabbitmq/definitions.json`. Hưng must review the exchange, queue, ACL, JWT and Billing schema handoff before a shared-environment run. Until D01/D02/D03/D04/D06 are delivered, the service intentionally stops at `PENDING_PAYMENT` and does not claim an end-to-end `CONFIRMED` demo.

AP-004 is only a read query; it does not reserve a slot. Gateway route/rate limiting and Catalog-owned doctor/service projection remain integration dependencies.

Run npm ci, npm run check, npm test and npm start from this directory. Set MONGODB_URI to a URI selecting appointment_db.
