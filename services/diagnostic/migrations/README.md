# migrations

- **Purpose:** Service database migrations.
- **Owner:** Huy
- **Add or change:** Keep source code, configuration, migrations, and tests within this folder's scope.

## ERD alignment migration

`000003_diagnostic_erd_alignment.up.sql` moves order fields and snapshots out of `lab_orders.body`, backfills `specimens`, `results`, `result_contributors`, `result_items`, and review decisions, then removes the aggregate JSON column. Stop the Diagnostic API and worker before migration and deploy the version that reads/writes the normalized tables before resuming commands.
