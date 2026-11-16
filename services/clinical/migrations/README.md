# migrations

- **Purpose:** Service database migrations.
- **Owner:** Huy
- **Add or change:** Keep source code, configuration, migrations, and tests within this folder's scope.

## ERD alignment migration

`000007_treatment_normalization.up.sql` backfills prescription lines into `prescription_items`, adds `finalized_by`, assigns unique visit-wide revisions, and renames the lab request key/snapshot columns to `id` and `test_snapshot`. Historical medicine lines must match the Clinical Catalog projection; the migration stops if it cannot preserve that identity. It keeps each FINAL prescription's existing revision so Pharmacy projections remain addressable.
