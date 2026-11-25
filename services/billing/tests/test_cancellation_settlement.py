import uuid
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase

from app.application.charge_service import handle_request_charge
from app.application.refund_service import apply_source_cancellation
from app.application.settlement_service import apply_settlement_reserved
from app.domain.models import CancellationEvidence, Charge, MessageInbox, Payment, Refund
from app.infrastructure.message_delivery import make_envelope
from tests.fixtures import create_saga


def charge_request():
    source_id = str(uuid.uuid4())
    event = make_envelope("RequestCharge", {
        "sourceType": "APPOINTMENT", "sourceId": source_id, "sourceRevision": 1,
        "patientId": str(uuid.uuid4()), "recipientUserId": str(uuid.uuid4()),
        "amountVnd": 1000, "snapshotHash": "a" * 64, "linesSnapshot": [],
    }, source_id, kind="COMMAND")
    event["producer"] = "appointment"
    return event


def cancellation(request):
    payload = request["payload"]
    event = make_envelope("AppointmentChanged", {
        "appointmentId": payload["sourceId"], "sourceRevision": 1,
        "changeType": "CANCELLED", "reasonCode": "PATIENT_REQUEST",
        "cancellationId": str(uuid.uuid4()), "version": 2,
    }, payload["sourceId"], 2)
    event["producer"] = "appointment"
    return event


def pending_settlement(request, state="REQUESTED"):
    handle_request_charge(request)
    charge = Charge.objects.get(source_id=request["payload"]["sourceId"])
    saga = create_saga(charge, state=state)
    Payment.objects.create(charge=charge, saga=saga, transaction_id=str(uuid.uuid4()))
    return charge, saga


def reservation(charge, saga, state):
    event = make_envelope("SettlementReserved", {
        "settlementId": str(saga.id), "sourceId": str(charge.source_id),
        "sourceRevision": charge.source_revision, "state": state,
        **({"fence": 1} if state == "ACCEPTED" else {}),
    }, charge.source_id)
    event["producer"] = "appointment"
    return event


class CancellationSettlementTests(TestCase):
    def test_late_charge_request_preserves_active_settlement_then_reconciles(self):
        for state in ("REQUESTED", "RESERVED", "IN_DOUBT"):
            for decision in ("ACCEPTED", "REJECTED"):
                with self.subTest(state=state, decision=decision):
                    request = charge_request()
                    charge, saga = pending_settlement(request, state)
                    apply_source_cancellation(cancellation(request))
                    charge.refresh_from_db()
                    self.assertEqual(charge.state, "OPEN")
                    self.assertFalse(Refund.objects.filter(charge=charge).exists())

                    late_request = deepcopy(request)
                    late_request["messageId"] = str(uuid.uuid4())
                    handle_request_charge(late_request)
                    charge.refresh_from_db()
                    self.assertEqual(charge.state, "OPEN")

                    event = reservation(charge, saga, decision)
                    apply_settlement_reserved(event)
                    apply_settlement_reserved(event)
                    charge.refresh_from_db()
                    if decision == "ACCEPTED":
                        self.assertEqual(charge.state, "PAID")
                        refund = Refund.objects.get(charge=charge)
                        self.assertEqual((refund.state, refund.amount_vnd), ("REQUESTED", 1000))
                    else:
                        self.assertEqual(charge.state, "VOID")
                        self.assertFalse(Refund.objects.filter(charge=charge).exists())

    def test_outbox_failure_rolls_back_refund_evidence_and_inbox(self):
        request = charge_request()
        charge, saga = pending_settlement(request)
        apply_settlement_reserved(reservation(charge, saga, "ACCEPTED"))
        event = cancellation(request)
        with patch("app.application.refund_workflow.enqueue_refund_status", side_effect=RuntimeError("outbox unavailable")):
            with self.assertRaisesRegex(RuntimeError, "outbox unavailable"):
                apply_source_cancellation(event)
        self.assertFalse(Refund.objects.filter(charge=charge).exists())
        self.assertFalse(CancellationEvidence.objects.filter(source_id=charge.source_id).exists())
        self.assertFalse(MessageInbox.objects.filter(message_id=event["messageId"]).exists())
        self.assertEqual(apply_source_cancellation(event), "APPLIED")
        self.assertEqual(Refund.objects.filter(charge=charge).count(), 1)


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL advisory and row locks")
class ConcurrentCancellationTests(TransactionTestCase):
    def run_concurrently(self, *operations):
        ready = Barrier(len(operations))

        def run(operation):
            connections.close_all()
            try:
                ready.wait(timeout=10)
                return operation[0](operation[1])
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(operations)) as pool:
            pending = [pool.submit(run, operation) for operation in operations]
            return [future.result(timeout=30) for future in pending]

    def test_cancellation_races_first_charge_creation(self):
        request = charge_request()
        self.run_concurrently(
            (handle_request_charge, request),
            (apply_source_cancellation, cancellation(request)),
        )
        charge = Charge.objects.get(source_id=request["payload"]["sourceId"])
        self.assertEqual(charge.state, "VOID")
        self.assertFalse(Refund.objects.exists())

    def test_cancellation_races_payment_commit(self):
        request = charge_request()
        charge, saga = pending_settlement(request)
        self.run_concurrently(
            (apply_settlement_reserved, reservation(charge, saga, "ACCEPTED")),
            (apply_source_cancellation, cancellation(request)),
        )
        charge.refresh_from_db()
        self.assertEqual(charge.state, "PAID")
        refund = Refund.objects.get(charge=charge)
        self.assertEqual((refund.state, refund.amount_vnd), ("REQUESTED", 1000))

    def test_two_cancellation_deliveries_create_one_refund(self):
        request = charge_request()
        charge, saga = pending_settlement(request)
        apply_settlement_reserved(reservation(charge, saga, "ACCEPTED"))
        event = cancellation(request)
        replay = deepcopy(event)
        replay["messageId"] = str(uuid.uuid4())
        self.run_concurrently(
            (apply_source_cancellation, event),
            (apply_source_cancellation, replay),
        )
        self.assertEqual(Refund.objects.filter(charge=charge).count(), 1)
