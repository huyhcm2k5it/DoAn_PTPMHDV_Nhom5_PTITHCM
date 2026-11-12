import uuid
from typing import Any, cast
from django.test import TestCase
from rest_framework.test import APIClient
from app.domain.models import BillingEventOutbox, Charge
from app.application.refund_service import apply_source_cancellation
from app.infrastructure.message_delivery import make_envelope
from tests.test_billing import cashier


class RefundEvidenceTests(TestCase):
    @staticmethod
    def _cashier_headers(code: str) -> dict[str, Any]:
        return {key: value for key, value in cashier(code).items() if key != "follow"}

    def test_lab_cancellation_refund_emits_all_transitions_once(self):
        order_id, visit_id, cancellation_id = (str(uuid.uuid4()) for _ in range(3))
        charge = Charge.objects.create(
            patient_id=uuid.uuid4(), recipient_user_id=uuid.uuid4(), source_type="LAB_ORDER",
            source_id=order_id, amount_vnd=1000, state="PAID", version=5,
        )
        evidence = make_envelope("LabCancelled", {
            "orderId": order_id, "visitId": visit_id, "cancellationId": cancellation_id,
            "noSpecimen": True, "reasonCode": "CANCELLED", "version": 2,
        }, order_id, 2)
        evidence["producer"] = "diagnostic"
        self.assertEqual(apply_source_cancellation(evidence), "APPLIED")
        client = cast(Any, APIClient())
        response = cast(Any, client.post("/api/v1/refunds", {
            "chargeId": str(charge.id), "sourceId": cancellation_id,
            "reasonCode": "CANCELLED", "amountVnd": 1000,
        }, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()), **self._cashier_headers("BI-007")))
        self.assertEqual(response.status_code, 201, response.json())
        refund = response.json()["data"]["refund"]
        for i, scenario in enumerate(("FAIL", "SUCCESS"), start=1):
            body = {"transactionId": f"test-attempt-{i}", "scenario": scenario, "expectedVersion": i}
            headers = {**self._cashier_headers("BI-008"), "HTTP_IDEMPOTENCY_KEY": str(uuid.uuid4())}
            path = f"/api/v1/refunds/{refund['id']}/execute"
            result = cast(Any, client.post(path, body, format="json", **headers))
            self.assertEqual(result.status_code, 200, result.json())
            replay = cast(Any, client.post(path, body, format="json", **headers))
            self.assertEqual(replay.status_code, 200, replay.json())
            self.assertEqual(replay.json()["data"], result.json()["data"])
        events = [row.payload for row in BillingEventOutbox.objects.filter(event_type="BillingStatusChanged")]
        events.sort(key=lambda event: event["aggregateVersion"])
        self.assertEqual([event["payload"]["refundStatus"] for event in events], ["REQUESTED", "FAILED", "SUCCEEDED"])
        self.assertEqual([event["aggregateVersion"] for event in events], [6, 7, 8])
        for event in events:
            self.assertEqual(event["aggregateVersion"], event["payload"]["version"])
            self.assertEqual(event["payload"]["sourceId"], order_id)
            self.assertEqual(event["payload"]["chargeId"], str(charge.id))

    def test_random_cancellation_is_not_refund_evidence(self):
        charge = Charge.objects.create(patient_id=uuid.uuid4(),source_type="APPOINTMENT",
            source_id=uuid.uuid4(),amount_vnd=1000,state="PAID")
        client = cast(Any, APIClient())
        response = cast(Any, client.post("/api/v1/refunds", {
            "chargeId":str(charge.id),"sourceId":str(uuid.uuid4()),
            "reasonCode":"CANCELLED","amountVnd":1000}, format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()), **self._cashier_headers("BI-007")))
        self.assertEqual(response.status_code,409)
        self.assertEqual(response.json()["error"]["code"],"CANCELLATION_EVIDENCE_REQUIRED")
