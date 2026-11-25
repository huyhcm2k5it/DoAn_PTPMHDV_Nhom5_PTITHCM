import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from app.api.view_notifications import serialize
from app.application.messages import digest
from app.domain.models import DeadLetter, LegacyMessageInbox, LegacyNotification, MessageInbox, Notification, NotificationDeliveryKey, ReceivedMessage, RetryJob
from app.worker.consumer import record_failure, route_event

class NotificationWireTests(TestCase):
    def test_invalid_envelope_metadata_has_no_business_writes(self):
        invalid = {
            "occurredAt": ["INVALID_DATE", "2026-02-30T10:00:00Z", "2026-11-23", "2026-11-23T10:00:00", None, 123],
            "correlationId": ["", "x" * 129, None],
            "requestId": ["invalid", 123], "causationId": ["invalid", 123],
            "messageId": [123, None], "aggregateId": [123, None],
            "aggregateVersion": [True, 0, 9007199254740992],
            "schemaVersion": [True, 2], "payload": [[], None],
        }
        for field, values in invalid.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    event = {**self.appointment_event(uuid.uuid4()), field: value}
                    with self.assertRaises((ValueError, TypeError)):
                        route_event("appointment.appointment-changed.v1", event)
                    self.assertFalse(ReceivedMessage.objects.exists())
                    self.assertFalse(MessageInbox.objects.exists())
                    self.assertFalse(Notification.objects.exists())
                    self.assertFalse(NotificationDeliveryKey.objects.exists())

    def test_valid_utc_and_offset_timestamps_are_accepted(self):
        for value in ("2026-11-23T01:10:00Z", "2026-11-23T08:10:00.123+07:00"):
            event = {**self.appointment_event(uuid.uuid4()), "occurredAt": value}
            self.assertEqual(route_event("appointment.appointment-changed.v1", event), "APPLIED")
        self.assertEqual(Notification.objects.count(), 2)

    def test_invalid_timestamp_is_recorded_as_dead_letter(self):
        event = {**self.appointment_event(uuid.uuid4()), "occurredAt": "INVALID_DATE"}
        routing = "appointment.appointment-changed.v1"
        with self.assertRaises(ValueError):
            route_event(routing, event)
        record_failure(routing, event, transient=False)
        self.assertEqual(DeadLetter.objects.get().reason, "INVALID_MESSAGE")
        self.assertFalse(RetryJob.objects.exists())
        self.assertFalse(Notification.objects.exists())

    def test_canonical_envelope_creates_one_minimal_notification(self):
        event={"messageId":str(uuid.uuid4()),"messageKind":"EVENT","messageType":"MedicationDispensed","schemaVersion":1,"producer":"pharmacy","aggregateId":str(uuid.uuid4()),"aggregateVersion":1,"correlationId":str(uuid.uuid4()),"causationId":None,"requestId":None,"occurredAt":timezone.now().isoformat(),"payload":{"recipientUserId":str(uuid.uuid4()),"prescriptionId":str(uuid.uuid4()),"drugName":"SECRET","diagnosis":"SECRET"}}
        route_event("pharmacy.medication-dispensed.v1",event)
        route_event("pharmacy.medication-dispensed.v1",event)
        event["messageId"]=str(uuid.uuid4())
        route_event("pharmacy.medication-dispensed.v1",event)
        self.assertEqual(Notification.objects.count(),1)
        self.assertNotIn("SECRET",str(serialize(Notification.objects.first())["payload"]))

    def test_billing_status_changed_creates_notification(self):
        recipient = str(uuid.uuid4())
        event = {
            "messageId": str(uuid.uuid4()),
            "messageKind": "EVENT",
            "messageType": "BillingStatusChanged",
            "schemaVersion": 1,
            "producer": "billing",
            "aggregateId": str(uuid.uuid4()),
            "aggregateVersion": 1,
            "correlationId": str(uuid.uuid4()),
            "causationId": None,
            "requestId": None,
            "occurredAt": timezone.now().isoformat(),
            "payload": {
                "recipientUserId": recipient,
                "chargeId": str(uuid.uuid4()),
                "paymentId": str(uuid.uuid4()),
                "state": "PAID",
                "version": 1,
            }
        }
        res = route_event("billing.billing-status-changed.v1", event)
        self.assertEqual(res, "APPLIED")
        notif = Notification.objects.filter(recipient_user_id=recipient).first()
        self.assertIsNotNone(notif)
        self.assertEqual(notif.kind, "BILLING")

    def test_appointment_and_diagnostic_events_route_properly(self):
        recipient = str(uuid.uuid4())
        appt_event = {
            "messageId": str(uuid.uuid4()),
            "messageKind": "EVENT",
            "messageType": "AppointmentChanged",
            "schemaVersion": 1,
            "producer": "appointment",
            "aggregateId": str(uuid.uuid4()),
            "aggregateVersion": 1,
            "correlationId": str(uuid.uuid4()),
            "causationId": None,
            "requestId": None,
            "occurredAt": timezone.now().isoformat(),
            "payload": {
                "recipientUserId": recipient,
                "appointmentId": str(uuid.uuid4()),
                "state": "CONFIRMED",
            }
        }
        self.assertEqual(route_event("appointment.appointment-changed.v1", appt_event), "APPLIED")

        diag_event = {
            "messageId": str(uuid.uuid4()),
            "messageKind": "EVENT",
            "messageType": "LabResultPublished",
            "schemaVersion": 1,
            "producer": "diagnostic",
            "aggregateId": str(uuid.uuid4()),
            "aggregateVersion": 1,
            "correlationId": str(uuid.uuid4()),
            "causationId": None,
            "requestId": None,
            "occurredAt": timezone.now().isoformat(),
            "payload": {
                "recipientUserId": recipient,
                "orderId": str(uuid.uuid4()),
                "publishedAt": timezone.now().isoformat(),
            }
        }
        self.assertEqual(route_event("diagnostic.lab-result-published.v1", diag_event), "APPLIED")
        self.assertEqual(Notification.objects.filter(recipient_user_id=recipient).count(), 2)

    def test_replay_cannot_replace_message_processed_before_migration(self):
        event = self.appointment_event(uuid.uuid4())
        LegacyMessageInbox.objects.create(message_id=event["messageId"], body_hash=digest(event))
        routing = "appointment.appointment-changed.v1"
        self.assertEqual(route_event(routing, event), "REPLAYED")
        event["payload"]["appointmentId"] = str(uuid.uuid4())
        with self.assertRaisesRegex(ValueError, "Duplicate message content conflict"):
            route_event(routing, event)
        self.assertFalse(ReceivedMessage.objects.exists())
        self.assertFalse(Notification.objects.exists())

    def test_archive_is_paginated_and_can_be_marked_read_only_by_recipient(self):
        user = uuid.uuid4()
        legacy = LegacyNotification.objects.create(
            user_id=user, kind="APPOINTMENT", title="Lịch cũ",
            body="Nội dung cũ", payload={"state": "CONFIRMED"},
        )
        LegacyNotification.objects.filter(pk=legacy.pk).update(
            created_at=timezone.now() - timedelta(days=1),
        )
        event = self.appointment_event(user)
        route_event("appointment.appointment-changed.v1", event)
        client = APIClient()
        url = "/api/v1/notifications"
        with patch("app.api.authz.authenticate", return_value=SimpleNamespace(user_id=user)):
            first = client.get(url, {"limit": 1}).json()["data"]
            second = client.get(url, {"limit": 1, "page": 2}).json()["data"]
            self.assertEqual(first["total"], 2)
            self.assertEqual(first["items"][0]["payload"], {"appointmentId": event["payload"]["appointmentId"]})
            self.assertEqual(second["items"][0]["id"], str(legacy.id))
            self.assertEqual(second["items"][0]["body"], "Nội dung cũ")
            self.assertEqual(second["items"][0]["payload"], {"state": "CONFIRMED"})
            mark = f"{url}/{legacy.id}/read"
            header = {"HTTP_IDEMPOTENCY_KEY": "legacy-read"}
            first_read = client.patch(mark, **header)
            self.assertEqual(first_read.status_code, 200)
            self.assertEqual(first_read.json()["data"], client.patch(mark, **header).json()["data"])
            self.assertEqual(client.get(url, {"unreadOnly": "true"}).json()["data"]["total"], 1)
        with patch("app.api.authz.authenticate", return_value=SimpleNamespace(user_id=uuid.uuid4())):
            self.assertEqual(client.get(url).json()["data"]["total"], 0)
            self.assertEqual(client.patch(mark, **header).status_code, 404)

    def test_conflicting_new_replay_keeps_first_message_and_notification(self):
        event = self.appointment_event(uuid.uuid4())
        routing = "appointment.appointment-changed.v1"
        route_event(routing, event)
        event["payload"]["appointmentId"] = str(uuid.uuid4())
        with self.assertRaisesRegex(ValueError, "Duplicate message content conflict"):
            route_event(routing, event)
        self.assertEqual(ReceivedMessage.objects.count(), 1)
        self.assertEqual(MessageInbox.objects.count(), 1)
        self.assertEqual(Notification.objects.count(), 1)

    def appointment_event(self, recipient):
        appointment_id = str(uuid.uuid4())
        return {
            "messageId": str(uuid.uuid4()), "messageKind": "EVENT",
            "messageType": "AppointmentChanged", "schemaVersion": 1,
            "producer": "appointment", "aggregateId": appointment_id,
            "aggregateVersion": 1, "correlationId": str(uuid.uuid4()),
            "causationId": None, "requestId": None, "occurredAt": timezone.now().isoformat(),
            "payload": {"appointmentId": appointment_id, "recipientUserId": str(recipient)},
        }
