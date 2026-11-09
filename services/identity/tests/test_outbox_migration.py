"""Regression coverage for the historical 0005 -> 0006 outbox rename."""
import importlib
import uuid

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.recorder import MigrationRecorder
from django.test import TestCase


class IdentityOutboxMigrationTests(TestCase):
    def setUp(self):
        if connection.vendor != 'postgresql':
            self.skipTest('Migration upgrade compatibility requires PostgreSQL.')
        schema = 'outbox_test_' + uuid.uuid4().hex
        with connection.cursor() as cursor:
            cursor.execute('CREATE SCHEMA ' + schema)
            cursor.execute('SET LOCAL search_path TO ' + schema)
        with connection.schema_editor() as editor:
            editor.create_model(MigrationRecorder.Migration)
        executor = MigrationExecutor(connection)
        self.before = executor.loader.project_state([('app', '0005_identityeventoutbox')])
        migration = importlib.import_module('app.migrations.0006_identityoutbox').Migration
        self.operation = migration.operations[0]
        self.after = self.before.clone()
        self.operation.state_forwards('app', self.after)
        self.model = self.after.apps.get_model('app', 'IdentityOutbox')

    def apply(self):
        with connection.schema_editor() as editor:
            self.operation.database_forwards('app', editor, self.before, self.after)

    def legacy_table(self, marker=True):
        with connection.schema_editor() as editor:
            editor.create_model(self.model)
        if marker:
            MigrationRecorder(connection).record_applied('app', '0005_identityoutbox')
        return self.model.objects.create(aggregate_id=uuid.uuid4(), version=1, envelope={'retained': True})

    def test_fresh_database_creates_outbox(self):
        self.apply()
        self.assertEqual(self.model.objects.count(), 0)

    def test_legacy_rename_preserves_existing_message(self):
        row = self.legacy_table()
        self.apply()
        self.assertEqual(self.model.objects.get(pk=row.pk).envelope, {'retained': True})

    def test_legacy_schema_drift_is_rejected(self):
        self.legacy_table()
        with connection.cursor() as cursor:
            cursor.execute('ALTER TABLE app_identityoutbox DROP CONSTRAINT uq_identity_access_version')
        with self.assertRaisesRegex(RuntimeError, 'schema'):
            self.apply()

    def test_unrecognized_existing_table_is_rejected(self):
        self.legacy_table(marker=False)
        with self.assertRaisesRegex(RuntimeError, 'history'):
            self.apply()

    def test_legacy_history_without_table_is_rejected(self):
        MigrationRecorder(connection).record_applied('app', '0005_identityoutbox')
        with self.assertRaisesRegex(RuntimeError, 'missing'):
            self.apply()
