# Diagnostic: order and specimen integration

Implemented boundary: DI-002–006 in `diagnostic.openapi.json`. DI-001 recovery creation remains disabled. Result entry/review/publication is a later increment.

The doctor submits CL-005 to Clinical. Its transaction commits the pending registry and `CreateLabOrder` outbox together. Diagnostic consumes that command from `umc.commands.clinical.v1`, routing `diagnostic.create-lab-order.v1`; it does not accept patient identity, prices or paid status from the browser. The immutable test definitions are verified against its local Catalog projection. Price versions and patient ownership must already be projected locally.

One transaction deduplicates the clinical request, creates the order, writes `RequestCharge` for Billing and emits `LabOrderResolved` for Clinical. HTTP 202 from Clinical remains pending until the actual result is received. Retries must preserve request ID/hash; conflicting content is rejected. The canonical request hash is SHA-256 of Go JSON encoding of a map containing requestId, visitId, patientId, doctorId, testSnapshot and authorizedAt (keys sorted, hash excluded).

Billing must send `ChargePrepared`, perform `ReserveSettlement`/`SettlementReserved`, and supply a matching terminal decision/payment event. A charge ID alone does not allow collecting a specimen. The owner checks source revision, amount hash, settlement ID and fence. UNKNOWN keeps the source locked; FAILED tombstones prevent a late reserve from relocking it. Locked settlements are queried periodically through outbox, without an HTTP call to Billing.

LAB_TECH can collect, reject with reason/version, and recollect. Recollection retains the order/charge and increments the specimen sequence; barcodes are unique. LAB_REVIEW reads the queue/detail. An assigned DOCTOR may inspect order detail. Patient access is excluded from these staff endpoints.

The web feature accepts the team's authenticated transport. Route registration and session management remain in their existing owner modules. The standalone preview proxies Diagnostic to localhost:8083; it does not create accepted claims or successful payments.

Run `tools/huy/test_diagnostic_postgres.py` for the isolated native PostgreSQL suite. CI runs PostgreSQL plus RabbitMQ adapter tests. Shared Gate 3 additionally requires the actual Identity, Appointment and Billing services, Gateway routes, broker ACLs and a clean Compose journey; local fixtures do not establish that whole-group result.

Bootstrap limitation: the existing Catalog implementation does not yet publish the full entity stream/checkpoints. Trusted operator projection import is a provisional integration path, not a public endpoint or evidence of live stream freshness. The service fails closed when required projections are missing/stale. Do not refresh checkpoints manually to make a production payment pass.
