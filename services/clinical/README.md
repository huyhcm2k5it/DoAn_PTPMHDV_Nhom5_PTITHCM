# Clinical

Owner: Huy. Go/Echo/pgx, with domain and application ports independent from drivers. The service now covers CL-001–011 across worklist, visit notes, LAB requests, prescriptions, signing and patient medical-record reads.

| Operation | Behavior |
| --- | --- |
| CL-001 `GET /api/v1/clinical/worklist` | Own doctor's visits, UTC date/state filters and pagination. `operationId` reads that doctor's start request even before a visit exists. |
| CL-002 `POST /api/v1/visits/start` | Atomically writes PENDING start request, idempotency response and ClaimQueueTicket outbox. Returns `202`, `Location` and `statusUrl`; no visit exists yet. |
| CL-003 `GET /api/v1/visits/{visitId}` | Assigned doctor reads drafts. A patient can read only their owned SIGNED visit and its latest saved note. |
| CL-004 `PUT /api/v1/visits/{visitId}/draft` | Replaces all four fields using expectedVersion and Idempotency-Key, creates an immutable note revision and increments visit version. |
| CL-011 `GET /api/v1/patients/{patientId}/medical-records` | Paginated, no-store records for the patient owner: signed visits, the latest note saved by signing time, FINAL prescriptions and published LAB references only. |

An ACCEPTED QueueTicketClaimed event creates one FIRST visit per appointment; RETURN resumes the same eligible visit once. REJECTED creates no visit. Both message ID and business result are deduplicated; conflicting terminal results are quarantined. A stale draft returns 409 and SIGNED visits cannot be edited.

## Run with online services

From the repository root, load `CLINICAL_DATABASE_URL` from Huy's private env as the process `DATABASE_URL`. It must select `clinical_db` on Neon with `sslmode=require`. Configure the RSA public key supplied by Hưng. This service never reads another service's database. The placeholders below are examples, not usable credentials.

```powershell
$env:DATABASE_URL='postgresql://REPLACE_USER:REPLACE_PASSWORD@REPLACE_NEON_HOST/clinical_db?sslmode=require'
$env:JWT_ISSUER='YOUR_IDENTITY_ISSUER'
$env:JWT_AUDIENCE='YOUR_API_AUDIENCE'
$env:JWT_PUBLIC_KEY_FILE='C:/absolute/path/to/identity-public.pem'
./tools/huy/go.ps1 clinical run ./cmd/migrate
./tools/huy/go.ps1 clinical run ./cmd/api
```

`LISTEN_ADDR` defaults to `127.0.0.1:8008`. All JWT settings must be configured together; absent JWT configuration leaves business endpoints fail-closed with 503. The token must be RS256, have the configured issuer/audience/expiry, UUID subject, actorType and tokenVersion. IdentityAccessChanged updates the local account projection; revocation or a changed tokenVersion blocks access. CL-002 and CL-004 use Bearer auth according to CSV v5.2, without adding an authorization-lease requirement.

Health live checks the process. Health ready checks Clinical's schema migration; it does not certify queue projections, Gateway, Identity or end-to-end integration. HTTP errors use `error.code`, `error.message` and `meta.correlationId`. Logs include route templates/message IDs/correlationId, never medical-note bodies or tokens.

## Ticket handoff and fake fixtures

The baseline command requires patientId although CL-002 accepts only ticketId/doctorId/version. The pre-claim ticket feed is not yet defined by Appointment. The operator-only importer is a provisional integration boundary; it does not add a public API or a new baseline event.

```powershell
./tools/huy/go.ps1 clinical run ./cmd/import-tickets -file services/clinical/tests/fixtures/tickets.json
```

Only import a trusted Appointment export. `doctorId` identifies the Catalog doctor while `doctorUserId` is the JWT subject. The API verifies their mapping from this snapshot, never from patientId supplied by a browser. Missing projection returns 503; the actual Appointment consumer must still validate ticket version/assignment when claiming.

The following fake fixture is for isolated development only; do not use it as evidence of the online group demo:

```powershell
$env:CLINICAL_ALLOW_DEMO_SEED='1'
./tools/huy/go.ps1 clinical run ./cmd/migrate -seed-demo
```

This seeds a fake doctor/patient/ticket only; it never manufactures an ACCEPTED claim or a successful visit. See the fixture JSON for IDs. Shared environments must use Identity/Patient projections and real Appointment snapshots.

## Worker and RabbitMQ

After migration, start the worker with the same online database URL and Quân's shared `UMC_AMQP_URL`. Use the actual CloudAMQP vhost:

```powershell
$env:RABBITMQ_URL='amqps://REPLACE_USER:REPLACE_PASSWORD@REPLACE_BROKER_HOST:5671/REPLACE_VHOST'
./tools/huy/go.ps1 clinical run ./cmd/worker
```

Quân provisions the shared topology/ACLs. Incoming queue `evt.clinical.v1` binds `appointment.queue-ticket-claimed.v1`, `identity.identity-access-changed.v1` and `patient.patient-access-changed.v1` to their producer exchanges. Clinical publishes ClaimQueueTicket to `umc.commands.clinical.v1` with routing key `appointment.claim-queue-ticket.v1`; Appointment's `cmd.appointment.v1` must be bound. The technical quarantine exchange `umc.deadletters.clinical.v1` routes `clinical.quarantine.v1` to restricted queue `dlq.clinical.v1`.

`CLINICAL_DECLARE_TOPOLOGY=1` optionally creates Clinical-owned exchanges/queues/bindings for development; foreign producer exchanges must already exist. Production workers normally use pre-provisioned topology. See [the integration contract](../../contracts/http/clinical-integration.md).

The worker uses manual ack, prefetch 10, durable DB retries at 5/15/60 seconds plus jitter, lease-based restart recovery, and quarantine plus a transactional dead-letter outbox. It acks the original delivery only after the effect, retry or quarantine is durable. No hot requeue loop is used. Publisher confirms and mandatory returns keep unconfirmed/unroutable outbox records PENDING. Crash after publish confirmation but before DB commit may redeliver the same message ID; receivers deduplicate it.

## Check the implementation

```powershell
./tools/huy/go.ps1 clinical test ./...
./tools/huy/go.ps1 clinical vet ./...
./tools/huy/go.ps1 clinical build ./...
python tools/huy/test_clinical_postgres.py
python -m pip install -r tools/huy/contract-requirements.txt
python tools/huy/check_clinical_contract.py .runtime/clinical-http-responses.json
```

The native PostgreSQL runner creates a unique `umc_huy_test_clinical_*` database in a task-owned loopback cluster, runs real transaction/HTTP/concurrency tests, exports non-sensitive response fixtures and removes that exact test database. Override PG_BIN/GO_BIN/HUY_TEST_PG_PORT if needed. Unit tests use no broker. To exercise real AMQP mandatory confirms/returns, set TEST_RABBITMQ_URL to an isolated test broker and run `go test -tags=brokerintegration ./internal/adapters/inbound/amqp` from this service. CI also runs both database and broker integration tags.

For the doctor UI, see [Clinical feature](../../apps/web/src/features/clinical/README.md) and [standalone preview](../../tools/clinical-preview/README.md). Actual queue/Gateway/Identity/shell integration requires Quân/Hưng's adapters and is a separate verification gate.

## Week 3 treatment boundary

CL-005–010 add durable LAB requests, prescription drafts and visit/prescription signing. Every write requires a UUID Idempotency-Key. CL-009 and CL-010 additionally require X-Authorization-Lease: RS256, same issuer/audience/sub/tokenVersion as the caller, action matching the API ID, lifetime at most 30 seconds. A lease refresh retries the same body and key.

CreateLabOrder is stored in the same PostgreSQL transaction as the pending request and visit version. LabOrderResolved is consumed only from Diagnostic's event exchange/routing key. No response from Diagnostic means pending, which blocks signing. Clinical does not call Diagnostic or Billing synchronously. The LAB request hash uses Go JSON canonical map key ordering and excludes requestHash itself.

Prescription names come from Clinical's trusted Catalog projection. Draft updates replace lines using expectedVersion; quantity must be a positive integer. Visit signing locks the visit and checks all registered LAB requests. FINAL requires a signed visit, at least one line, and no other FINAL prescription. Signed notes and FINAL prescriptions are immutable. Patient detail filters out draft/deleted prescriptions and internal LAB requests.

CL-011 supports the PATIENT owner after checking the active PatientAccess projection and a current CL-011 authorization lease. DOCTOR access fails closed with 503 until the current doctor/visit assignment projection is supplied by the owning service; Clinical does not infer permission from a historical ticket snapshot.

`cmd/import-catalog -file trusted-catalog.json` is an operator-only bootstrap while the shared Catalog entity stream is being wired. Input is an array of `{ "kind": "MEDICINE" | "LAB_TEST", "entity": { "id", "code", "name", "unit", "referenceRange", "revision", "status" } }`. Import checks monotonic revisions and rejects conflicting content at the same revision. No public HTTP bootstrap endpoint exists. Medicine/test full CatalogChanged snapshots keep this projection current. Price/checkpoint messages are not used for financial decisions in Clinical; Diagnostic owns lab pricing.

The worker binds `catalog.catalog-changed.v1` on `umc.events.catalog.v1` and `diagnostic.lab-order-resolved.v1`, `diagnostic.lab-result-published.v1`, `diagnostic.lab-cancelled.v1` on `umc.events.diagnostic.v1`. It also accepts the old `lab.order-resolved.v1` route while pending deliveries drain. It retains terminal events received before order resolution and emits one `clinical.visit-return-ready.v1` only when all registered LAB requests have reached a terminal state. It also publishes `clinical.visit-signed.v1` / `clinical.prescription-finalized.v1` on `umc.events.clinical.v1`. Foreign exchanges must be provisioned by the shared topology owner.

Verification: `go test ./...`, `go vet ./...`, and `go test -tags=integration ./internal/adapters/outbound/postgres` with TEST_DATABASE_URL restricted to an isolated umc_huy_test* database. Optional CLINICAL_WEEK3_CONTRACT_RESPONSE_FILE captures actual RSA-authenticated HTTP responses. Tests cover unsigned FINAL rejection, immutable FINAL, atomic single signing event, LAB/signing serialization, required leases, multiple LAB requests and patient privacy. Full Appointment/Billing/Pharmacy/Gateway integration remains dependent on those owners' running adapters.
