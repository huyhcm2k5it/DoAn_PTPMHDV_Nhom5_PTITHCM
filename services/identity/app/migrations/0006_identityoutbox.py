"""Create the outbox, or validate the identical historical 0005 table.

An earlier checkout shipped this model under 0005_identityoutbox. Keep that
history and its rows; never silently accept an unrelated or drifted table.
"""
import re
import uuid

from django.db import migrations, models
from django.db.migrations.recorder import MigrationRecorder


class CreateCompatibleIdentityOutbox(migrations.CreateModel):
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return
        connection = schema_editor.connection
        legacy = MigrationRecorder(connection).migration_qs.filter(
            app=app_label, name='0005_identityoutbox'
        ).exists()
        with connection.cursor() as cursor:
            exists = model._meta.db_table in connection.introspection.table_names(cursor)
            if not exists:
                if legacy:
                    raise RuntimeError('Legacy Identity outbox table is missing; inspect migration history.')
                return super().database_forwards(app_label, schema_editor, from_state, to_state)
            if not legacy:
                raise RuntimeError('Existing Identity outbox has no recognized legacy migration history.')
            if connection.vendor != 'postgresql':
                raise RuntimeError('Legacy Identity outbox schema verification requires PostgreSQL.')

            cursor.execute(
                'SELECT column_name, data_type, is_nullable FROM information_schema.columns '
                'WHERE table_schema = current_schema() AND table_name = %s',
                [model._meta.db_table],
            )
            actual = {name: (kind, nullable) for name, kind, nullable in cursor.fetchall()}
            expected = {
                'id': ('uuid', 'NO'),
                'aggregate_id': ('uuid', 'NO'),
                'version': ('bigint', 'NO'),
                'envelope': ('jsonb', 'NO'),
                'published_at': ('timestamp with time zone', 'YES'),
                'attempts': ('integer', 'NO'),
                'created_at': ('timestamp with time zone', 'NO'),
            }
            constraints = connection.introspection.get_constraints(cursor, model._meta.db_table)
            primary_key = any(c['primary_key'] and c['columns'] == ['id'] for c in constraints.values())
            unique = constraints.get('uq_identity_access_version', {})
            unique_ok = unique.get('unique') and unique.get('columns') == ['aggregate_id', 'version']
            cursor.execute(
                'SELECT pg_get_constraintdef(oid) FROM pg_constraint '
                'WHERE conrelid = %s::regclass AND contype = %s',
                [model._meta.db_table, 'c'],
            )
            checks = {re.sub(r'[\s()"]', '', row[0]) for row in cursor.fetchall()}
            if (actual != expected or not primary_key or not unique_ok
                    or not {'CHECKversion>=0', 'CHECKattempts>=0'}.issubset(checks)):
                raise RuntimeError('Legacy Identity outbox schema differs; manual reconciliation is required.')
        # Django records 0006 normally after validating the already-applied DDL.


class Migration(migrations.Migration):
    dependencies = [('app', '0005_identityeventoutbox')]

    operations = [
        CreateCompatibleIdentityOutbox(
            name='IdentityOutbox',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('aggregate_id', models.UUIDField()),
                ('version', models.PositiveBigIntegerField()),
                ('envelope', models.JSONField()),
                ('published_at', models.DateTimeField(null=True)),
                ('attempts', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('aggregate_id', 'version'), name='uq_identity_access_version')],
            },
        ),
    ]
