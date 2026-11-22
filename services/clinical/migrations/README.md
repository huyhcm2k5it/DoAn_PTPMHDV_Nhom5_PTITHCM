# migrations

- **Purpose:** Service database migrations.
- **Owner:** Huy
- **Add or change:** Keep source code, configuration, migrations, and tests within this folder's scope.

## ERD alignment migration

`000007_treatment_normalization.up.sql` backfills prescription lines into `prescription_items`, adds `finalized_by`, assigns unique visit-wide revisions, and renames the lab request key/snapshot columns to `id` and `test_snapshot`. Historical medicine lines must match the Clinical Catalog projection; the migration stops if it cannot preserve that identity. It keeps each FINAL prescription's existing revision so Pharmacy projections remain addressable.

## Broker delivery upgrade

`000008_broker_delivery.up.sql` requires old APIs/workers to be stopped before upgrade. Delivery state is transferred into the existing outbox before removing the redundant delivery tables. Broker retry envelopes retain the original ID, source, attempt, token and NotBefore. The new worker must have access to its owned retry queue before publishing pending outbox rows. Unknown or conflicting legacy records stop migration; the transaction rolls back.
