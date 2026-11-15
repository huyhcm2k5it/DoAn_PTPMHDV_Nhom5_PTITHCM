import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from typing import Any, cast
from unittest import skipUnless

from django.db import IntegrityError, connection, connections, transaction
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from app.application.settlement_service import mark_in_doubt
from app.domain.models import Charge, Payment, Receipt, SettlementSaga
from tests.fixtures import create_charge, create_saga
from tests.test_billing import patient


def appointment_charge():
    return create_charge(
        patient_id=uuid.uuid4(), source_type="APPOINTMENT", source_id=uuid.uuid4(),
        amount_vnd=350000, snapshot_hash="a" * 64,
    )


class NormalizedSettlementTests(TestCase):
    def test_charge_reads_timeout_from_current_saga(self):
        charge = appointment_charge()
        saga = create_saga(charge)
        self.assertEqual(mark_in_doubt(saga.deadline_at + timedelta(seconds=1)), 1)
        charge.refresh_from_db(from_queryset=None)
        self.assertEqual(charge.settlement_state, "IN_DOUBT")

    def test_database_rejects_a_second_success_or_receipt(self):
        charge = appointment_charge()
        first_saga = create_saga(charge, state="SUCCEEDED")
        first = Payment.objects.create(
            charge=charge, saga=first_saga, transaction_id="first", state="SUCCEEDED",
        )
        Receipt.objects.create(payment=first, charge=charge, receipt_no="first", amount_vnd=charge.amount_vnd)
        second_saga = SettlementSaga.objects.create(
            charge=charge, state="FAILED", deadline_at=timezone.now(),
        )
        second = Payment.objects.create(
            charge=charge, saga=second_saga, transaction_id="second", state="FAILED",
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            Payment.objects.filter(pk=second.pk).update(state="SUCCEEDED")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Receipt.objects.create(
                payment=second, charge=charge, receipt_no="second", amount_vnd=charge.amount_vnd,
            )


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL constraints and row locks")
class ConcurrentSettlementTests(TransactionTestCase):
    def test_source_foreign_key_is_enforced(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Charge.objects.create(
                source_type="APPOINTMENT", source_id=uuid.uuid4(), amount_vnd=350000,
            )

    def test_parallel_requests_create_one_attempt(self):
        charge = appointment_charge()
        headers = patient(charge.patient_id)
        ready = Barrier(2)

        def submit(number):
            try:
                ready.wait(timeout=10)
                response = cast(Any, APIClient().post(
                    "/api/v1/payments/simulate",
                    {"chargeId": str(charge.id), "transactionId": f"parallel-{number}"},
                    format="json", HTTP_IDEMPOTENCY_KEY=f"parallel-key-{number}", **cast(Any, headers),
                ))
                return response.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(submit, (1, 2))), [202, 409])
        self.assertEqual(Payment.objects.filter(charge=charge).count(), 1)
        self.assertEqual(SettlementSaga.objects.filter(charge=charge).count(), 1)
