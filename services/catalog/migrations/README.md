# migrations

- **Purpose:** Service database migrations.
- **Owner:** Huy
- **Add or change:** Keep source code, configuration, migrations, and tests within this folder's scope.

## ERD alignment migration

`000004_catalog_erd_alignment.up.sql` makes `price_versions.created_by` required and stores missing optional medicine/test descriptions as SQL `NULL`. It drops the old NOT NULL constraints before normalizing existing empty descriptions. The migration assigns known demo price rows to the seeded demo admin only when their ID, item type, item ID, revision and amount match the seed. If another historical price row has no creator, resolve its audit provenance before retrying. Reused seed UUIDs alone do not identify the creator.
