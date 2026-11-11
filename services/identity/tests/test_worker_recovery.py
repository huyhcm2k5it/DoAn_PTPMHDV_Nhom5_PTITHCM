"""Real PostgreSQL connection loss must not strand the durable Identity outbox."""
import json
import os
import uuid
from unittest import skipUnless
from unittest.mock import MagicMock, patch

from django.db import connection
from django.test import TransactionTestCase

from app.application.access_events import publish_access
from app.domain.models import IdentityOutbox, User
from app.management.commands.run_identity_worker import Command


class StopWorker(BaseException):
    pass


def terminate_database_session():
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_backend_pid()")
        pid = cursor.fetchone()[0]
    control = connection.copy(alias="recovery_control")
    try:
        with control.cursor() as cursor:
            cursor.execute("SELECT pg_terminate_backend(%s)", [pid])
            if not cursor.fetchone()[0]:
                raise AssertionError("Test could not terminate its own database session")
    finally:
        control.close()


@skipUnless(connection.vendor == "postgresql", "Requires actual PostgreSQL connection loss")
class IdentityWorkerRecoveryTests(TransactionTestCase):
    def test_outbox_publishes_after_database_connection_is_lost(self):
        user = User.objects.create(phone="0900000987", status="ACTIVE")
        publish_access(user)
        event = IdentityOutbox.objects.get(aggregate_id=user.id)
        published = []
        attempts = []

        def connect(_params):
            if len(attempts) == 3:
                raise StopWorker()
            broker = MagicMock()
            broker.is_open = True
            broker.close.side_effect = lambda: setattr(broker, "is_open", False)
            if not attempts:
                terminate_database_session()
            attempts.append(broker)

            def publish(**kwargs):
                # Broker confirmation must precede marking a durable row published.
                row = IdentityOutbox.objects.get(pk=event.pk)
                self.assertIsNone(row.published_at)
                published.append(json.loads(kwargs["body"])["messageId"])

            broker.channel.return_value.basic_publish.side_effect = publish
            broker.process_data_events.side_effect = StopWorker()
            return broker

        with patch.dict(os.environ, {"UMC_AMQP_URL": "amqp://guest:guest@localhost/"}), \
                patch("app.management.commands.run_identity_worker.pika.BlockingConnection", side_effect=connect), \
                patch("app.management.commands.run_identity_worker.time.sleep"):
            try:
                Command().handle()
            except StopWorker:
                pass
            finally:
                connection.close()
        event.refresh_from_db()
        self.assertEqual(published, [event.envelope["messageId"]])
        self.assertIsNotNone(event.published_at)
        self.assertEqual(event.attempts, 1)

    def test_failed_publish_keeps_outbox_pending(self):
        user = User.objects.create(phone="0900000987", status="ACTIVE")
        publish_access(user)
        event = IdentityOutbox.objects.get(aggregate_id=user.id)
        broker = MagicMock()
        broker.is_open = True
        broker.close.side_effect = lambda: setattr(broker, "is_open", False)
        broker.channel.return_value.basic_publish.side_effect = RuntimeError("Broker confirmation lost")
        with patch.dict(os.environ, {"UMC_AMQP_URL": "amqp://guest:guest@localhost/"}), \
                patch("app.management.commands.run_identity_worker.pika.BlockingConnection", side_effect=[broker, StopWorker()]), \
                patch("app.management.commands.run_identity_worker.time.sleep"):
            try:
                Command().handle()
            except StopWorker:
                pass
        event.refresh_from_db()
        self.assertIsNone(event.published_at)
        self.assertEqual(event.attempts, 0)
