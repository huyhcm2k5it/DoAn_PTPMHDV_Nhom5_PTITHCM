from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from unittest import skipUnless
import uuid

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from app.api.view_notifications import serialize
from app.domain.models import MessageInbox, Notification, ReceivedMessage
from app.worker.consumer import route_event


def envelope(kind, producer, aggregate, version, payload):
    return {
        "messageId": str(uuid.uuid4()), "messageKind": "EVENT",
        "messageType": kind, "schemaVersion": 1, "producer": producer,
        "aggregateId": str(aggregate), "aggregateVersion": version,
        "correlationId": str(uuid.uuid4()), "causationId": None,
        "requestId": None, "occurredAt": timezone.now().isoformat(),
        "payload": payload,
    }


class BusinessNotificationTests(TestCase):
    def test_all_appointment_changes_use_the_owner_payload_and_dedupe(self):
        recipient, appointment, patient = (str(uuid.uuid4()) for _ in range(3))
        route = "appointment.appointment-changed.v1"
        for version, change in enumerate(("CONFIRMED", "RESCHEDULED", "CANCELLED", "EXPIRED"), 1):
            payload = {
                "appointmentId": appointment, "patientId": patient,
                "recipientUserId": recipient, "changeType": change,
                "version": version,
            }
            if change in ("CANCELLED", "EXPIRED"):
                payload.update(
                    cancellationId=str(uuid.uuid4()), sourceRevision=1,
                    reasonCode="PAYMENT_TIMEOUT" if change == "EXPIRED" else "PATIENT_REQUEST",
                )
            event = envelope("AppointmentChanged", "appointment", appointment, version, payload)
            self.assertEqual(route_event(route, event), "APPLIED")
            self.assertEqual(route_event(route, event), "REPLAYED")
            replay = deepcopy(event)
            replay["messageId"] = str(uuid.uuid4())
            route_event(route, replay)
        self.assertEqual(Notification.objects.filter(recipient_user_id=recipient).count(), 4)
        for notification in Notification.objects.all():
            self.assertEqual(serialize(notification)["payload"], {"appointmentId": appointment})

    def test_paid_and_all_refund_transitions_are_delivered_once(self):
        recipient, charge, refund = (str(uuid.uuid4()) for _ in range(3))
        route = "billing.billing-status-changed.v1"
        for version, state in enumerate(("PAID", "REQUESTED", "FAILED", "SUCCEEDED"), 1):
            payload = {"chargeId": charge, "recipientUserId": recipient, "version": version}
            if state == "PAID":
                payload.update(state="PAID", paymentId=str(uuid.uuid4()))
            else:
                payload.update(
                    state="REFUNDED" if state == "SUCCEEDED" else "PAID",
                    refundId=refund, refundStatus=state,
                )
            event = envelope("BillingStatusChanged", "billing", charge, version, payload)
            route_event(route, event)
            route_event(route, event)
        self.assertEqual(Notification.objects.count(), 4)
        self.assertEqual(MessageInbox.objects.count(), 4)
        for notification in Notification.objects.all():
            self.assertEqual(serialize(notification)["payload"], {"chargeId": charge})

    def test_published_results_and_dispensed_medication_expose_only_references(self):
        for kind, producer, route, field in (
            ("LabResultPublished", "diagnostic", "diagnostic.lab-result-published.v1", "orderId"),
            ("MedicationDispensed", "pharmacy", "pharmacy.medication-dispensed.v1", "prescriptionId"),
        ):
            subject = str(uuid.uuid4())
            event = envelope(kind, producer, subject, 1, {
                field: subject, "recipientUserId": str(uuid.uuid4()),
                "diagnosis": "PRIVATE_MEDICAL_DETAIL", "itemsSnapshot": ["PRIVATE_MEDICAL_DETAIL"],
                "resultValue": "PRIVATE_MEDICAL_DETAIL",
            })
            route_event(route, event)
            notification = Notification.objects.get(event_id=event["messageId"])
            self.assertEqual(serialize(notification)["payload"], {field: subject})
            self.assertNotIn("PRIVATE_MEDICAL_DETAIL", str(serialize(notification)))

    def test_invalid_recipient_or_wrong_producer_has_no_notification_or_inbox(self):
        for changes in (
            {"producer": "billing"},
            {"payload": {"appointmentId": str(uuid.uuid4())}},
        ):
            event = envelope("AppointmentChanged", "appointment", uuid.uuid4(), 1, {
                "appointmentId": str(uuid.uuid4()), "recipientUserId": str(uuid.uuid4()),
            })
            event.update(changes)
            with self.assertRaises((ValueError, KeyError)):
                route_event("appointment.appointment-changed.v1", event)
        self.assertFalse(ReceivedMessage.objects.exists())
        self.assertFalse(MessageInbox.objects.exists())
        self.assertFalse(Notification.objects.exists())


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL concurrent inserts")
class ConcurrentNotificationTests(TransactionTestCase):
    def test_republished_aggregate_version_delivers_once_under_concurrency(self):
        subject = str(uuid.uuid4())
        event = envelope("AppointmentChanged", "appointment", subject, 1, {
            "appointmentId": subject, "recipientUserId": str(uuid.uuid4()),
            "changeType": "CONFIRMED", "version": 1,
        })
        republished = deepcopy(event)
        republished["messageId"] = str(uuid.uuid4())
        ready = Barrier(2)

        def deliver(value):
            connections.close_all()
            try:
                ready.wait(timeout=10)
                return route_event("appointment.appointment-changed.v1", value)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(deliver, value) for value in (event, republished)]
            self.assertEqual([future.result(timeout=30) for future in futures], ["APPLIED", "APPLIED"])
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(MessageInbox.objects.count(), 2)
