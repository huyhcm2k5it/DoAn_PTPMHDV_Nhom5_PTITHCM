# Clinical week 2 integration

Implemented scope: CSV v5.2 CL-001–004, SRS FR-15 and UC-06. Machine-readable HTTP contract: `clinical.openapi.json`; message schema: `../messages/clinical-queue.v1.schema.json`.

## Queue claim

1. Client sends ticketId, doctorId, expectedTicketVersion and UUID Idempotency-Key to CL-002. No patientId, claimId or final state is accepted from the browser.
2. Clinical verifies the authenticated DOCTOR against local Identity access and a trusted ticket snapshot. doctorId is the Catalog doctor ID; doctorUserId is the Identity subject.
3. One Clinical transaction writes PENDING start_requests, the idempotency result and ClaimQueueTicket to outbox. HTTP returns 202 with statusUrl/Location. requestId and operationId identify this durable start request.
4. Clinical publishes to `umc.commands.clinical.v1`, key `appointment.claim-queue-ticket.v1`. Quân binds `cmd.appointment.v1`, verifies expected version/assignment and returns QueueTicketClaimed from `umc.events.appointment.v1` to `evt.clinical.v1`.
5. The Clinical consumer verifies broker exchange, messageKind/type, producer, schema version and stored request/ticket/appointment/patient context. FIRST ACCEPTED creates one visit per appointment. RETURN ACCEPTED must supply the existing visitId and resume RETURN_READY/WAITING_RETURN, without a new visit or charge. REJECTED stores its reason and creates no visit. Terminal result mismatches are quarantined.
6. Client polls CL-001 using operationId. Only the requesting doctor's request is visible. ACCEPTED includes visitId, REJECTED includes reasonCode, PENDING remains pending across restarts/timeouts.

The command includes requestId, ticketId, expectedTicketVersion, doctorId and patientId, exactly as the baseline. QueueTicketClaimed includes requestId, ticketId, appointmentId, patientId, state plus claimId for ACCEPTED, reasonCode for REJECTED and visitId for RETURN. FIRST omits visitId because Clinical generates its ID. Envelope correlationId is preserved from HTTP; causationId/requestId link the chain. The worker logs only IDs/type/correlation, not clinical payloads.

## Ticket snapshot gap requiring Quân review

The baseline does not define how Clinical learns patientId/departmentId and the mapping between doctorId and doctorUserId before emitting ClaimQueueTicket. No extra business event or HTTP operation has been silently added. `clinical-ticket-snapshot.v1.schema.json` defines the provisional operator-only export/import shape. It is not a claim response and cannot create a visit. `cmd/import-tickets` writes only Clinical's own projection; same-version conflicting snapshots are rejected and older versions cannot overwrite newer data.

Quân must confirm the source and delivery/bootstrap of this projection (or agree a reviewed baseline change). Until present, CL-002 returns SERVICE_UNAVAILABLE. API/component/database tests exercise trusted fake fixtures; they do not prove a live Appointment→Clinical handoff.

## Identity, Patient, Gateway and web

Hưng provides RS256 public key/issuer/audience, UUID subject, actorType and tokenVersion. IdentityAccessChanged and PatientAccessChanged are consumed transactionally with version guards. Missing/revoked projections fail closed. The patient's CL-003 response requires owned SIGNED visit state and returns only the final saved note; draft revisions remain doctor-only.

Hưng routes these four paths through Gateway without exposing DB or worker interfaces. Quân imports the Clinical feature at the doctor worklist route, supplies selectedTicket from the queue UI and wires the shared transport/session. No shell/shared API source is changed by Huy's feature.

## Booking and price snapshot review for Gate 2

The existing Catalog response returns amountVnd as an integer, stable priceVersionId/revision and effectiveFrom/effectiveTo; absent effective price stays null. A new future price version must leave the prior accepted booking snapshot unchanged. Appointment owns the confirmed quote and emits RequestCharge; Billing does not fetch the current Catalog price to reprice it.

Before the booking gate, Quân/Hưng must verify sourceType/sourceId/sourceRevision, patient/actor context, priceVersion, pricingAt, expiresAt, snapshotHash, amountVnd and currency agree across quote→hold→RequestCharge→ChargePrepared. ChargePaid and SettlementDecision must match the authoritative charge/source/fence; pending/late/duplicate payment events cannot manufacture CONFIRMED or resurrect an expired source. These are consumer-owner review criteria, not a claim that their booking/Billing implementation exists or has passed integration.

## Delivery evidence

Native PostgreSQL tests assert PENDING before claim, single visit under eight duplicate claim deliveries, RETURN reusing visit, rejected claims, idempotency conflicts, six concurrent draft writers, rollback on outbox insertion error, auth revocation, strict payloads, durable retry leases and quarantine outbox. Real RSA-backed HTTP responses can be checked against OpenAPI. The separate broker integration test requires a real isolated RabbitMQ endpoint to verify mandatory publisher confirms/returns. A full Gate 2 still requires the actual owner services, Gateway, shell and clean Compose run.
