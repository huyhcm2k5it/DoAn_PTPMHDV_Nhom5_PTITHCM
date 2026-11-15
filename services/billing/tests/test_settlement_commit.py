import uuid

from tests.fixtures import create_charge, create_saga
from unittest.mock import patch
from django.test import TestCase
from app.domain.models import Payment, Receipt
from app.worker.consumer import process_pending_settlements

class SettlementSafetyTests(TestCase):
    def test_no_success_without_reserved_even_failed_saga(self):
        for state in ["REQUESTED", "FAILED", "IN_DOUBT"]:
            charge=create_charge(patient_id=uuid.uuid4(),source_type="APPOINTMENT",source_id=uuid.uuid4(),amount_vnd=1000)
            saga=create_saga(charge, state=state)
            payment=Payment.objects.create(charge=charge,saga=saga,transaction_id=str(uuid.uuid4()))
            with patch("app.worker.consumer.publish_charge_paid",return_value=False): process_pending_settlements()
            payment.refresh_from_db(); saga.refresh_from_db();charge.refresh_from_db()
            self.assertEqual(payment.state,"PENDING")
            self.assertEqual(saga.state,state)
            self.assertEqual(charge.state,"OPEN")
        self.assertEqual(Receipt.objects.count(),0)

    def test_only_matching_ACCEPTED_reservation_commits_once(self):
        from app.application import settlement_service as service
        from tests.test_charge_wire import envelope
        charge=create_charge(patient_id=uuid.uuid4(),source_type="APPOINTMENT",source_id=uuid.uuid4(),amount_vnd=1000,snapshot_hash="hash")
        saga=create_saga(charge)
        payment=Payment.objects.create(charge=charge,saga=saga,transaction_id="TXN_123")
        event=envelope("SettlementReserved",payload={"settlementId":str(saga.id),"chargeId":str(charge.id),"sourceType":charge.source_type,"sourceId":str(charge.source_id),"sourceRevision":1,"attemptVersion":1,"amountHash":"hash","state":"ACCEPTED","fence":7})
        event["messageKind"]="EVENT"
        handler=getattr(service,"apply_settlement_reserved",lambda event:None)
        handler(event);handler(event)
        payment.refresh_from_db();saga.refresh_from_db();charge.refresh_from_db()
        self.assertEqual(payment.state,"SUCCEEDED")
        self.assertEqual(saga.fence,7)
        self.assertEqual(Receipt.objects.count(),1)
