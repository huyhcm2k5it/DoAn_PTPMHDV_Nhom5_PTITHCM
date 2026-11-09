# migrations

- **Purpose:** Service database migrations.
- **Owner:** Hung
- **Add or change:** Keep source code, configuration, migrations, and tests within this folder's scope.

## Historical IdentityOutbox rename

An earlier checkout applied `0005_identityoutbox`; the current migration is `0006_identityoutbox`, after `0005_identityeventoutbox`. Migration 0006 handles both a fresh database and this specific upgrade history. It retains the legacy table only after checking PostgreSQL column types/nullability, primary key, the aggregate/version unique constraint, and nonnegative counters. Missing tables, unknown history, or schema drift fail explicitly.

Run normal `python manage.py migrate --noinput`; do not delete the volume or fake the migration. Existing rows and the historical migration record are retained. Regression coverage lives in `tests/test_outbox_migration.py` and runs against PostgreSQL in isolated schemas.
