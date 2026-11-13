# Appointment booking integration

This note covers AP-008 through AP-012. The HTTP implementation is intentionally fail-closed when the Identity access policy, Catalog price projection, Gateway, or Billing message contract is unavailable.

## Request and response boundary

- `POST /api/v1/appointment-holds` accepts only `patientId` and `slotId`, plus a UUID `Idempotency-Key`. The server resolves the slot and accepted price snapshot locally.
- New holds require valid `doctorUserId` (Identity subject) and `departmentId` UUIDs on the admin-owned schedule. A legacy or malformed schedule returns `409 CLINICAL_MAPPING_UNAVAILABLE` before capacity is reserved. An administrator must repair the schedule mapping; clients cannot supply it in the hold payload. Existing hold retries keep their stored idempotent response.
- `DELETE /api/v1/appointment-holds/{holdId}` requires the caller's ownership/capability and the same idempotency key on retry.
- `POST /api/v1/appointments` consumes an active hold and returns `202` with `requestId`, `appointmentId`, `PENDING_PAYMENT`, and `statusUrl`. It writes `RequestCharge` to the Appointment outbox in the same Mongo transaction.
- AP-011 reports local `chargeSync`, `chargeStatus`, and `refundStatus`. `ChargePrepared` never means payment succeeded.
- AP-012 is scoped by the local patient access policy and uses page 1/20 with a maximum limit of 100.

## State and capacity

Appointment keeps the reservation in `heldCount` through `PENDING_PAYMENT` and `SETTLEMENT_LOCKED`. A valid settlement moves one reservation to `confirmedCount`; expiry releases it once. This convention must be reviewed with Billing before the Gate 2 demo.

The 10-minute hold expiry is a domain operation. A Mongo TTL index may remove old records later, but it cannot be the mechanism that restores capacity.

## Cross-service handoff

Appointment emits `RequestCharge` and `ReserveSettlement` commands on `cmd.billing.v1`, and consumes `ChargePrepared`, `ChargePaid`, and `SettlementDecision`. Appointment owns the local settlement lock and publishes `SettlementReserved` only after the command is accepted in a Mongo transaction. The broker topology, Billing schema and public-key/lease configuration remain external handoffs until the integrated Compose gate.
