# migrations

- **Purpose:** Service database migrations.
- **Owner:** Huy
- **Add or change:** Keep source code, configuration, migrations, and tests within this folder's scope.

## ERD alignment migration

`000003_diagnostic_erd_alignment.up.sql` moves order fields and snapshots out of `lab_orders.body`, backfills `specimens`, `results`, `result_contributors`, `result_items`, and review decisions, then removes the aggregate JSON column. Stop the Diagnostic API and worker before migration and deploy the version that reads/writes the normalized tables before resuming commands.

## Broker delivery upgrade

`000004_broker_delivery.up.sql` requires old APIs/workers to be stopped before upgrade. Delivery state is transferred into the existing outbox before removing the redundant delivery tables. Broker retry envelopes retain the original ID, source, attempt, token and NotBefore. The new worker must have access to its owned retry queue before publishing pending outbox rows. Unknown or conflicting legacy records stop migration; the transaction rolls back.

The migration validates barcode registry entries against specimens before removing the registry, and moves legacy replay entries from objects into idempotency_records without changing response data.
