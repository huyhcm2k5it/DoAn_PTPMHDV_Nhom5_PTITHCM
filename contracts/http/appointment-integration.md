# Appointment booking integration

This note covers AP-008 through AP-012. The HTTP implementation is intentionally fail-closed when the Identity access policy, Catalog price projection, Gateway, or Billing message contract is unavailable.

## Request and response boundary

- `POST /api/v1/appointment-holds` accepts only `patientId` and `slotId`, plus a UUID `Idempotency-Key`. The server resolves the slot and accepted price snapshot locally.
- `DELETE /api/v1/appointment-holds/{holdId}` requires the caller's ownership/capability and the same idempotency key on retry.
- `POST /api/v1/appointments` consumes an active hold and returns `202` with `requestId`, `appointmentId`, `PENDING_PAYMENT`, and `statusUrl`. It writes `RequestCharge` to the Appointment outbox in the same Mongo transaction.
- AP-011 reports local `chargeSync`, `chargeStatus`, and `refundStatus`. `ChargePrepared` never means payment succeeded.
- AP-012 is scoped by the local patient access policy and uses page 1/20 with a maximum limit of 100.

## State and capacity

Appointment keeps the reservation in `heldCount` through `PENDING_PAYMENT` and `SETTLEMENT_LOCKED`. A valid settlement moves one reservation to `confirmedCount`; expiry releases it once. This convention must be reviewed with Billing before the Gate 2 demo.

The 10-minute hold expiry is a domain operation. A Mongo TTL index may remove old records later, but it cannot be the mechanism that restores capacity.

## Cross-service handoff

Appointment emits `RequestCharge` on `cmd.billing.v1` and consumes `ChargePrepared`, `SettlementReserved`, `ChargePaid`, and `SettlementDecision` only after producer/schema/source/fence checks. The broker topology, Billing schema and public-key/lease configuration are external handoffs; until they are delivered, local tests stop at the durable `PENDING_PAYMENT` boundary.
