# Patient service

Owner: Quân. Runtime: Node.js 24, Express 5, Mongoose 9, JavaScript CommonJS.

## APIs and authorization

- Health: `GET /health/live`, `GET /health/ready`.
- Profiles: list, search, create, read and update under `/api/v1/patients`.
- The production entrypoint verifies Identity RS256 access tokens. Configure `JWT_PUBLIC_KEY_FILE`, `JWT_ISSUER` and `JWT_AUDIENCE` consistently with Identity.
- Reads and mutations require an ACTIVE Identity projection with the current token version. Create/update additionally require the corresponding short-lived authorization lease and an `Idempotency-Key`.
- MongoDB must select `patient_db`. Storage bootstrap creates the owner collections, technical inbox/outbox and unique user projection index.

## Worker

Run the API with `npm start` and the separate worker with `npm run worker`. Set `MONGODB_URI` and `AMQP_URL`; the latter supports `amqps://` for TLS.

The worker consumes `IdentityAccessChanged` from `evt.patient.v1`, updates the local access projection and publishes `PatientAccessChanged` from the durable outbox. Starting only the API does not synchronize account permissions.

Identity's canonical registration state is `UNVERIFIED`; queued legacy `PENDING_VERIFICATION` is accepted as inactive. Duplicate messages are idempotent, older versions cannot replace newer permissions, and conflicting content is quarantined. Delivery ACK follows committed projection or committed retry/quarantine storage. An unavailable database leaves the delivery unacked.

The worker drains durable retries and publishes quarantine to `dlq.patient.v1`, preserving the original message ID and bytes. Broker startup failure releases Mongo; server cancellation closes the worker connection so the process supervisor can restart it. Compose enables `restart: unless-stopped` for the main worker.

## Verification

From this service: `npm ci`, `npm run format:check`, `npm run check`, `npm test`.

From `tests/mongo`: `npm ci --ignore-scripts`, `npm test`. `patient-identity-projection.test.js` covers onboarding, authorization denial, version conflicts, concurrent delivery and lifecycle failures using a temporary MongoDB replica set.

`patient-broker.integration.js` additionally requires a real broker URL in `TEST_AMQP_URL` selecting an isolated `quan-ci-*` vhost. It verifies live delivery, consumer restart and quarantine. CI gives Patient and Pharmacy separate vhosts; never point these tests at the shared application vhost.

The isolated nine-service stack is started from the repository root with `python tools/be/start_test_stack.py`; it derives local test credentials and keys without reading owner env files. Its gateway listens on `127.0.0.1:18080`. Health readiness alone does not prove all business journeys.
