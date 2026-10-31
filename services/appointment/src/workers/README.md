# Appointment workers

The worker modules are deliberately dependency-injected so the domain tests do not need a live broker:

- `outbox-publisher.worker.js` publishes durable `RequestCharge` commands through a RabbitMQ confirm channel and marks an outbox row only after confirmation.
- `billing-events.worker.js` consumes Billing events after source/revision/charge/fence checks and deduplicates with `inbox`.
- `access-projection.service.js` is the local projection consumer for Identity/Patient access messages and applies monotonic policy versions.

The process wrapper, AMQP connection, retry backoff and quarantine queue must be wired by the service owner after D01/D04/D06 are handed over. A worker must ACK only after the Mongo transaction commits; malformed or terminal-conflict messages must be quarantined rather than hot-requeued.
