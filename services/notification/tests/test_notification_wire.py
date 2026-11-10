import uuid
from django.test import TestCase
from django.utils import timezone
from app.domain.models import Notification
from app.worker.consumer import route_event

class NotificationWireTests(TestCase):
    def test_canonical_envelope_creates_one_minimal_notification(self):
        event={"messageId":str(uuid.uuid4()),"messageKind":"EVENT","messageType":"MedicationDispensed","schemaVersion":1,"producer":"pharmacy","aggregateId":str(uuid.uuid4()),"aggregateVersion":1,"correlationId":str(uuid.uuid4()),"causationId":None,"requestId":None,"occurredAt":timezone.now().isoformat(),"payload":{"recipientUserId":str(uuid.uuid4()),"holdId":str(uuid.uuid4()),"drugName":"SECRET","diagnosis":"SECRET"}}
        route_event("pharmacy.medication-dispensed.v1",event)
        route_event("pharmacy.medication-dispensed.v1",event)
        event["messageId"]=str(uuid.uuid4())
        route_event("pharmacy.medication-dispensed.v1",event)
        self.assertEqual(Notification.objects.count(),1)
        self.assertNotIn("SECRET",str(Notification.objects.first().payload))

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
        notif = Notification.objects.filter(user_id=recipient).first()
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
        self.assertEqual(Notification.objects.filter(user_id=recipient).count(), 2)
