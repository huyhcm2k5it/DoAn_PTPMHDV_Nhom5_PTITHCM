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
