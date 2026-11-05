# Week 3 handoff — Quan / Appointment queue slice

Date: 2026-11-05

Branch: `quan`

Owner: Quan

Suggested reviewers: Hung (Identity/Gateway/Billing), Huy (Clinical queue contract)

Status: **REVIEW** (local implementation; not pushed or merged)

## Delivered in this handoff

- AP-015 `POST /api/v1/appointments/{appointmentId}/check-in`.
- AP-016 `GET /api/v1/queues/today`.
- AP-017 `POST /api/v1/queues/call-next`.
- AP-018 `POST /api/v1/queues/{ticketId}/no-show`.
- Queue ticket model/indexes with `FIRST`/`RETURN`, return round, version and CAS transitions.
- Appointment states `CHECKED_IN` and `NO_SHOW`, with check-in/no-show audit fields.
- `ChargePaid` now moves one slot atomically from `heldCount` to `confirmedCount`.
- Identity access projection accepts the agreed `version` field and stores the local monotonic policy version.
- Appointment outbox selects command versus event exchange by message kind.

## Contract and authorization

- Check-in and no-show require a STAFF bearer with `RECEPTION` capability.
- Queue read/call accepts STAFF with `RECEPTION` or a DOCTOR actor. Doctor-to-catalog `doctorUserId` mapping is still an integration dependency and must be reviewed before live doctor scope is enabled.
- Check-in requires appointment date in Vietnam time, `CONFIRMED`, and local `chargeStatus=PAID`.
- Duplicate check-in returns the existing FIRST ticket. A duplicate or stale queue action is rejected by `expectedVersion`.
- FIRST no-show changes the appointment to `NO_SHOW`; RETURN no-show changes only the ticket and does not create a new visit or charge.

## Local commands and evidence

```powershell
npm.cmd --prefix services/appointment run check
npm.cmd --prefix services/appointment run test:integration
```

Evidence from 2026-11-05:

- `check`: exit code 0.
- Appointment/access integration: 11 passed, 0 failed, exit code 0.
- New coverage includes AP-015 payment/date guard and one FIRST ticket, AP-016 list, AP-017 CAS call, AP-018 version conflict/no-show, and slot counter settlement.
- Mongoose emitted only a deprecation warning for `findOneAndUpdate({ new: true })`; no test failure.

## Files in scope

- `services/appointment/src/services/queue.service.js`
- `services/appointment/src/controllers/queue.controller.js`
- `services/appointment/src/routes/queue.routes.js`
- `services/appointment/src/models/appointment.model.js`
- `services/appointment/src/dbs/indexes.js`
- `services/appointment/src/workers/billing-events.worker.js`
- `services/appointment/src/workers/outbox-publisher.worker.js`
- `services/appointment/src/services/access-projection.service.js`
- `tests/mongo/booking.test.js`

## Sample requests

```http
POST /api/v1/appointments/{appointmentId}/check-in
Authorization: Bearer <staff-token>
Idempotency-Key: <uuid>
```

```json
{}
```

```http
GET /api/v1/queues/today?date=2026-10-31&ticketType=FIRST&page=1&limit=20
Authorization: Bearer <staff-token>
```

```http
POST /api/v1/queues/call-next
Authorization: Bearer <staff-token>
Idempotency-Key: <uuid>
Content-Type: application/json

{"ticketType":"FIRST"}
```

```http
POST /api/v1/queues/{ticketId}/no-show
Authorization: Bearer <staff-token>
Idempotency-Key: <uuid>
Content-Type: application/json

{"reasonCode":"PATIENT_ABSENT","expectedVersion":2}
```

## Blockers and receiver actions

- Hưng must finish the real Identity session/refresh/lease flow and confirm issuer/audience/tokenVersion before this is considered live-auth integrated.
- Hưng must confirm Billing envelope parsing and `ReserveSettlement -> SettlementReserved -> ChargePaid` producer/consumer wiring. The local slot-counter test uses a valid, injected event; it is not proof of live RabbitMQ delivery.
- Huy must confirm the trusted ticket snapshot fields and the `ClaimQueueTicket`/`QueueTicketClaimed` mapping, especially `doctorId` versus `doctorUserId` and RETURN `visitId`.
- Receiver should run the commands above on the integrated source, then run the Gateway/Compose smoke path. Do not mark `INTEGRATED` from this local Mongo replica-set evidence alone.

## Git handoff

- No push or merge was performed.
- Local commit: `59bed56 feat(appointment): deliver check-in and queue slice`.
- No PR was created; open `quan` -> `develop` only after the receiver checks the contract and scope.
