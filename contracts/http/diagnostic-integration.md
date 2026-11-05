# Diagnostic: order and specimen integration

Implemented boundary: DI-002–006 in `diagnostic.openapi.json`. DI-001 recovery creation remains disabled. Result entry/review/publication is a later increment.

The doctor submits CL-005 to Clinical. Its transaction commits the pending registry and `CreateLabOrder` outbox together. Diagnostic consumes that command from `umc.commands.clinical.v1`, routing `diagnostic.create-lab-order.v1`; it does not accept patient identity, prices or paid status from the browser. The immutable test definitions are verified against its local Catalog projection. Price versions and patient ownership must already be projected locally.

One transaction deduplicates the clinical request, creates the order, writes `RequestCharge` for Billing and emits `LabOrderResolved` for Clinical. HTTP 202 from Clinical remains pending until the actual result is received. Retries must preserve request ID/hash; conflicting content is rejected. The canonical request hash is SHA-256 of Go JSON encoding of a map containing requestId, visitId, patientId, doctorId, testSnapshot and authorizedAt (keys sorted, hash excluded).

Billing must send `ChargePrepared`, perform `ReserveSettlement`/`SettlementReserved`, and supply a matching terminal decision/payment event. A charge ID alone does not allow collecting a specimen. The owner checks source revision, amount hash, settlement ID and fence. UNKNOWN keeps the source locked; FAILED tombstones prevent a late reserve from relocking it. Locked settlements are queried periodically through outbox, without an HTTP call to Billing.

LAB_TECH can collect, reject with reason/version, and recollect. Recollection retains the order/charge and increments the specimen sequence; barcodes are unique. LAB_REVIEW reads the queue/detail. An assigned DOCTOR may inspect order detail. Patient access is excluded from these staff endpoints.

The web feature accepts the team's authenticated transport. Route registration and session management remain in their existing owner modules. The standalone preview proxies Diagnostic to localhost:8083; it does not create accepted claims or successful payments.

Run `tools/huy/test_diagnostic_postgres.py` for the isolated native PostgreSQL suite. CI runs PostgreSQL plus RabbitMQ adapter tests. Shared Gate 3 additionally requires the actual Identity, Appointment and Billing services, Gateway routes, broker ACLs and a clean Compose journey; local fixtures do not establish that whole-group result.

Bootstrap limitation: the existing Catalog implementation does not yet publish the full entity stream/checkpoints. Trusted operator projection import is a provisional integration path, not a public endpoint or evidence of live stream freshness. The service fails closed when required projections are missing/stale. Do not refresh checkpoints manually to make a production payment pass.

## DI-007–013: result lifecycle, cancellation and patient reads

Result writes keep the existing order/specimen representation until migration BK-05 normalizes specimen history and results. DI-007 selects the latest active `COLLECTED` specimen on the order; the request contains `items[]` with `testCode`, `valueText` and optional `unit`, `referenceRange`, `flag`. `testCode` must exist exactly once in the immutable order snapshot. Unit and reference range are sourced from that snapshot; optional client copies are accepted only when equal. A draft may be incomplete, but DI-009 requires every ordered test exactly once before REVIEW.

DI-008 requires `expectedVersion` and accepts only DRAFT/REWORK; each successful edit appends the actor to the revision contributor history. DI-009 requires LAB_TECH and moves a complete result into REVIEW. DI-010 requires LAB_REVIEW, a nonempty reason and expectedVersion and returns REVIEW to REWORK. DI-011 requires LAB_REVIEW, expectedVersion and an authorization lease; it atomically publishes only when the reviewer is absent from contributors. PUBLISHED revisions are immutable. Every mutation requires a UUID Idempotency-Key and replays only the original request hash/response.

`LabResultPublished` has metadata only (`orderId`, `visitId`, result `revision`, `publishedAt`, `recipientUserId`, order `version`); it never carries values, units, reference ranges or clinical text. `LabCancelled` carries `orderId`, `visitId`, stable `cancellationId`, `noSpecimen=true`, `reasonCode` and order `version`. See `../messages/lab-lifecycle.v1.schema.json`. Billing consumes the cancellation event and owns void/refund. Diagnostic returns `PENDING_SYNC` until a versioned Billing status projection is received; it never claims a refund succeeded from the cancellation command alone.

Compatibility decision: persisted and existing `state` values stay unchanged (`PENDING_PAYMENT`, `SPECIMEN_COLLECTED`, `SPECIMEN_REJECTED`, etc.). The additive `lifecycleState` exposes canonical aliases `WAITING_PAYMENT`, `SAMPLING`, and `RECOLLECT_REQUIRED` for those three values. Existing messages are accepted only through the producer/routing aliases already deployed; new Catalog events use lowercase `catalog` and `catalog.catalog-changed.v1`. `DI-001` remains disabled and is not registered in OpenAPI or public Gateway.

DI-012 requires a current doctor/visit ownership projection, authorization lease, expectedVersion and reasonCode. It serializes with collect/recollect/reserve under the order transaction and checks the complete specimen history. Any historical specimen, including REJECTED, permanently blocks cancellation. A repeated key/cancellation cannot emit a second refund basis. Billing remains responsible for refund execution/status.

DI-013 requires PATIENT owner or an authorized DOCTOR plus a current read lease. It returns only PUBLISHED results, ordered by publication time and stable ID cursor/page; it never exposes DRAFT, REVIEW, REWORK or contributor history. Result response bodies are `no-store` and are excluded from application logs.
