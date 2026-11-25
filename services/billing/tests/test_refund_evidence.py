import uuid

from tests.fixtures import create_charge
from typing import Any, cast
from django.test import TestCase
from rest_framework.test import APIClient
from app.domain.models import BillingEventOutbox, Charge, CancellationEvidence, Refund, BillingAuditEvent
from app.application.refund_service import apply_source_cancellation
from app.application.charge_service import handle_request_charge
from app.infrastructure.message_delivery import make_envelope
from tests.test_billing import cashier
from copy import deepcopy


class RefundEvidenceTests(TestCase):
    def test_expiry_voids_unpaid_charge_in_both_delivery_orders(self):
        for cancellation_first in (True, False):
            with self.subTest(cancellation_first=cancellation_first):
                source_id, patient_id, owner_id = (str(uuid.uuid4()) for _ in range(3))
                cancellation = make_envelope("AppointmentChanged", {
                    "appointmentId": source_id, "patientId": patient_id,
                    "recipientUserId": owner_id, "changeType": "EXPIRED",
                    "reasonCode": "PAYMENT_TIMEOUT", "version": 2,
                    "cancellationId": str(uuid.uuid4()), "sourceRevision": 1,
                }, source_id, 2)
                cancellation["producer"] = "appointment"
                request = make_envelope("RequestCharge", {
                    "sourceType": "APPOINTMENT", "sourceId": source_id, "sourceRevision": 1,
                    "patientId": patient_id, "recipientUserId": owner_id,
                    "amountVnd": 1000, "snapshotHash": "a" * 64, "linesSnapshot": [],
                }, source_id, kind="COMMAND")
                request["producer"] = "appointment"
                handlers = [(apply_source_cancellation, cancellation), (handle_request_charge, request)]
                if not cancellation_first:
                    handlers.reverse()
                for handler, envelope in handlers:
                    self.assertEqual(handler(envelope), "APPLIED")
                self.assertEqual(handle_request_charge(request), "DUPLICATE")
                self.assertEqual(apply_source_cancellation(cancellation), "APPLIED")
                self.assertEqual(Charge.objects.get(source_id=source_id).state, "VOID")
                self.assertEqual(CancellationEvidence.objects.filter(source_id=source_id).count(), 1)

    @staticmethod
    def _cashier_headers(code: str) -> dict[str, Any]:
        return {key: value for key, value in cashier(code).items() if key != "follow"}

    def test_lab_cancellation_refund_emits_all_transitions_once(self):
        order_id, visit_id, cancellation_id = (str(uuid.uuid4()) for _ in range(3))
        charge = create_charge(
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
        charge = create_charge(patient_id=uuid.uuid4(),source_type="APPOINTMENT",
            source_id=uuid.uuid4(),amount_vnd=1000,state="PAID")
        client = cast(Any, APIClient())
        response = cast(Any, client.post("/api/v1/refunds", {
            "chargeId":str(charge.id),"sourceId":str(uuid.uuid4()),
            "reasonCode":"CANCELLED","amountVnd":1000}, format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()), **self._cashier_headers("BI-007")))
        self.assertEqual(response.status_code,409)
        self.assertEqual(response.json()["error"]["code"],"CANCELLATION_EVIDENCE_REQUIRED")

    def _paid_charge_and_cancellation(self):
        charge = create_charge(
            patient_id=uuid.uuid4(),
            recipient_user_id=uuid.uuid4(),
            source_type="APPOINTMENT",
            source_id=uuid.uuid4(),
            amount_vnd=1000,
            state="PAID",
        )

        event = make_envelope(
            "AppointmentChanged",
            {
                "appointmentId": str(charge.source_id),
                "sourceRevision": charge.source_revision,
                "changeType": "CANCELLED",
                "reasonCode": "PATIENT_REQUEST",
                "cancellationId": str(uuid.uuid4()),
                "version": 2,
            },
            charge.source_id,
            2,
        )
        event["producer"] = "appointment"
        return charge, event

    def test_paid_cancellation_automatically_requests_full_refund(self):
        charge, event = self._paid_charge_and_cancellation()

        self.assertEqual(
            apply_source_cancellation(event), "APPLIED"
        )

        refund = Refund.objects.get(charge=charge)
        self.assertEqual(refund.state, "REQUESTED")
        self.assertEqual(refund.amount_vnd, 1000)
        self.assertEqual(refund.reason_code, "SOURCE_CANCELLED")

        status = BillingEventOutbox.objects.get(
            event_type="BillingStatusChanged"
        )
        self.assertEqual(
            status.payload["payload"]["refundStatus"],
            "REQUESTED",
        )

        self.assertEqual(
            BillingAuditEvent.objects.filter(
                action="REFUND_REQUESTED"
            ).count(),
            1,
        )

    def test_redelivery_has_no_additional_effects(self):
        charge, event = self._paid_charge_and_cancellation()

        apply_source_cancellation(event)
        apply_source_cancellation(event)

        # Cùng nghiệp vụ, messageId mới cũng không tạo thêm refund.
        repeated = deepcopy(event)
        repeated["messageId"] = str(uuid.uuid4())
        apply_source_cancellation(repeated)

        self.assertEqual(
            Refund.objects.filter(charge=charge).count(), 1
        )
        self.assertEqual(
            BillingEventOutbox.objects.filter(
                event_type="BillingStatusChanged"
            ).count(),
            1,
        )
        self.assertEqual(
            BillingAuditEvent.objects.filter(
                action="REFUND_REQUESTED"
            ).count(),
            1,
        )

    def test_same_message_id_with_changed_payload_is_rejected(self):
        charge, event = self._paid_charge_and_cancellation()
        apply_source_cancellation(event)

        conflicting = deepcopy(event)
        conflicting["payload"]["cancellationId"] = str(uuid.uuid4())

        with self.assertRaisesRegex(
            ValueError, "Message identity conflict"
        ):
            apply_source_cancellation(conflicting)

        self.assertEqual(
            Refund.objects.filter(charge=charge).count(), 1
        )
        self.assertEqual(
            CancellationEvidence.objects.filter(
                source_id=charge.source_id
            ).count(),
            1,
        )
