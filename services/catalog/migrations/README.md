# migrations

- **Purpose:** Service database migrations.
- **Owner:** Huy
- **Add or change:** Keep source code, configuration, migrations, and tests within this folder's scope.

## ERD alignment migration

`000004_catalog_erd_alignment.up.sql` makes `price_versions.created_by` required and stores missing optional medicine/test descriptions as SQL `NULL`. The migration assigns the known demo price rows to the seeded demo admin. If another historical price row has no creator, assign its real creator before retrying; the migration intentionally stops instead of inventing audit data.
