# migrations

- **Purpose:** Service database migrations.
- **Owner:** Huy
- **Add or change:** Keep source code, configuration, migrations, and tests within this folder's scope.

## ERD alignment migration

`000004_catalog_erd_alignment.up.sql` makes `price_versions.created_by` required and stores missing optional medicine/test descriptions as SQL `NULL`. It drops the old NOT NULL constraints before normalizing existing empty descriptions. The migration assigns known demo price rows to the seeded demo admin only when their ID, item type, item ID, revision and amount match the seed. If another historical price row has no creator, resolve its audit provenance before retrying. Reused seed UUIDs alone do not identify the creator.

## Broker delivery upgrade

`000005_broker_delivery.up.sql` requires old APIs/workers to be stopped before upgrade. Delivery state is transferred into the existing outbox before removing the redundant delivery tables. Historical quarantine metadata is preserved with historicalBodyUnavailable because the old table did not retain raw bodies. The price effective-from candidate key is also declared explicitly. The new worker must have access to its owned retry queue before publishing pending outbox rows. Unknown or conflicting legacy records stop migration; the transaction rolls back.
