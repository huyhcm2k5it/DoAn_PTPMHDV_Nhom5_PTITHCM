# Appointment workers

The worker modules are deliberately dependency-injected so the domain tests do not need a live broker:

- `outbox-publisher.worker.js` publishes durable `RequestCharge` commands through a RabbitMQ confirm channel and marks an outbox row only after confirmation.
- `billing-events.worker.js` consumes Billing events after source/revision/charge/fence checks and deduplicates with `inbox`.
- `clinical-events.worker.js` consumes `VisitSigned`/`VisitReturnReady`; `handleClaimQueueTicketCommand` handles Clinical's `ClaimQueueTicket` with CAS and durable `command_results`.
- `amqp-runtime.js` provisions the Appointment queues, uses manual ACK after Mongo commit, retries transient failures at 5/15/60 seconds, and quarantines terminal failures.
- `access-projection.service.js` is the local projection consumer for Identity/Patient access messages and applies monotonic policy versions.

`scripts/worker.js` is the production process wrapper. It still requires the shared broker vhost/ACL and owner-provided environment values before an integrated run. A worker ACKs only after the Mongo transaction commits; malformed or terminal-conflict messages are quarantined rather than hot-requeued.
