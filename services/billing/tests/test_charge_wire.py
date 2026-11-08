import uuid
from unittest.mock import patch
from django.test import TestCase
from django.utils import timezone
from app.domain.models import Charge, BillingEventOutbox
from app.worker.consumer import handle_request_charge


def envelope(kind="RequestCharge", producer="appointment", payload=None):
    return {"messageId":str(uuid.uuid4()),"messageKind":"COMMAND","messageType":kind,"schemaVersion":1,"producer":producer,"aggregateId":str(uuid.uuid4()),"aggregateVersion":1,"correlationId":str(uuid.uuid4()),"causationId":None,"requestId":str(uuid.uuid4()),"occurredAt":timezone.now().isoformat(),"payload":payload or {"requestId":str(uuid.uuid4()),"sourceType":"APPOINTMENT","sourceId":str(uuid.uuid4()),"sourceRevision":1,"patientId":str(uuid.uuid4()),"recipientUserId":str(uuid.uuid4()),"amountVnd":1000,"linesSnapshot":[],"snapshotHash":"a"*64}}

class ChargeWireTests(TestCase):
    def test_canonical_envelope_creates_charge_and_duplicate_one_effect(self):
        event=envelope()
        with patch("app.worker.consumer.publish_charge_prepared",return_value=False):
            handle_request_charge(event);handle_request_charge(event)
        self.assertEqual(Charge.objects.count(),1)
        self.assertEqual(BillingEventOutbox.objects.count(),1)
        self.assertEqual(BillingEventOutbox.objects.first().payload["payload"]["state"],"CREATED")
