"""Exercise reconnects against a real terminated PostgreSQL backend."""
import json
import uuid
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import MagicMock, patch

from django.db import connection
from django.test import TransactionTestCase
from django.utils import timezone

from app.domain.models import PatientAccessProjection, MessageInbox, BillingRetryJob, BillingDeadLetter
from app.worker.consumer import start_consumer
from app.worker import consumer
from app.application import settlement_service


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
class BillingWorkerRecoveryTests(TransactionTestCase):
    def exercise_reconnect(self, fail_during_delivery):
        event = {
            "messageId": str(uuid.uuid4()), "messageKind": "EVENT",
            "messageType": "PatientAccessChanged", "schemaVersion": 1,
            "producer": "patient", "aggregateId": str(uuid.uuid4()),
            "aggregateVersion": 1, "correlationId": str(uuid.uuid4()),
            "causationId": None, "requestId": None,
            "occurredAt": timezone.now().isoformat(),
            "payload": {"patientId": str(uuid.uuid4()), "ownerUserId": str(uuid.uuid4()), "policyVersion": 1, "active": True},
        }
        attempts = []
        acknowledgements = []
        delivery = SimpleNamespace(routing_key="patient.patient-access-changed.v1", delivery_tag=7)

        def connect():
            if len(attempts) == 3:
                raise StopWorker()
            broker = MagicMock()
            broker.is_open = True
            broker.close.side_effect = lambda: setattr(broker, "is_open", False)
            channel = broker.channel.return_value
            first = not attempts
            attempts.append(broker)
            callback = None

            def consume(**kwargs):
                nonlocal callback
                callback = kwargs["on_message_callback"]

            def acknowledge(**kwargs):
                # Check persisted effects from a separate session at the exact ACK boundary.
                control = connection.copy(alias="ack_control")
                try:
                    with control.cursor() as cursor:
                        cursor.execute("SELECT COUNT(*) FROM app_messageinbox WHERE message_id=%s", [event["messageId"]])
                        acknowledgements.append((kwargs["delivery_tag"], cursor.fetchone()[0]))
                finally:
                    control.close()

            def process(**kwargs):
                if first:
                    if not fail_during_delivery:
                        return  # Fail in the outbox scan after mark_in_doubt instead.
                    terminate_database_session()
                callback(channel, delivery, None, json.dumps(event).encode())
                raise StopWorker()

            channel.basic_consume.side_effect = consume
            channel.basic_ack.side_effect = acknowledge
            broker.process_data_events.side_effect = process
            return broker

        mark_in_doubt = settlement_service.mark_in_doubt

        def scan_settlements():
            result = mark_in_doubt()
            if not fail_during_delivery and len(attempts) == 1:
                # Lose the DB after the atomic settlement scan, before the outbox query.
                terminate_database_session()
            return result

        record_failure = consumer.record_failure

        def persist_failure(*args, **kwargs):
            if fail_during_delivery and len(attempts) == 1:
                # The database is still unavailable when trying to persist a retry.
                terminate_database_session()
            return record_failure(*args, **kwargs)

        with patch("app.worker.consumer.get_rabbitmq_connection", side_effect=connect), \
                patch("app.worker.consumer.record_failure", side_effect=persist_failure), \
                patch("app.worker.consumer.time.sleep"), \
                patch("app.application.settlement_service.mark_in_doubt", side_effect=scan_settlements):
            try:
                start_consumer()
            except StopWorker:
                pass
            finally:
                connection.close()
        self.assertEqual(acknowledgements, [(7, 1)])
        self.assertEqual(PatientAccessProjection.objects.count(), 1)
        self.assertEqual(MessageInbox.objects.count(), 1)
        self.assertEqual(BillingRetryJob.objects.count(), 0)
        self.assertEqual(BillingDeadLetter.objects.count(), 0)

    def test_retry_scan_recovers_after_database_connection_is_lost(self):
        self.exercise_reconnect(fail_during_delivery=False)

    def test_delivery_is_redelivered_without_ack_until_database_commit(self):
        self.exercise_reconnect(fail_during_delivery=True)
