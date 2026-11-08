import uuid
from django.test import TestCase
from rest_framework.test import APIClient
from app.domain.models import Charge
from tests.test_billing import cashier


class RefundEvidenceTests(TestCase):
    def test_random_cancellation_is_not_refund_evidence(self):
        charge = Charge.objects.create(patient_id=uuid.uuid4(),source_type="APPOINTMENT",
            source_id=uuid.uuid4(),amount_vnd=1000,state="PAID")
        response = APIClient().post("/api/v1/refunds", {
            "chargeId":str(charge.id),"sourceId":str(uuid.uuid4()),
            "reasonCode":"CANCELLED","amountVnd":1000}, format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()), **cashier("BI-007"))
        self.assertEqual(response.status_code,409)
        self.assertEqual(response.json()["error"]["code"],"CANCELLATION_EVIDENCE_REQUIRED")
