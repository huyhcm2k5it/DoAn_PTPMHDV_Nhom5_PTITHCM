import uuid
from django.test import TestCase
from django.utils import timezone
from app.domain.models import Charge, Payment, SettlementSaga, BillingEventOutbox, Receipt
from app.application.settlement_service import apply_settlement_reserved


class CanonicalSettlementWire(TestCase):
    def test_csv_state_without_undocumented_response_fields_commits(self):
        source_id = uuid.uuid4()
        charge = Charge.objects.create(patient_id=uuid.uuid4(), source_type="LAB_ORDER", source_id=source_id, amount_vnd=1000, snapshot_hash="a"*64)
        saga = SettlementSaga.objects.create(charge=charge, source_type="LAB_ORDER", source_id=source_id, amount_hash="a"*64)
        payment = Payment.objects.create(charge=charge, saga=saga, transaction_id="TXN_REAL_WIRE", amount_vnd=1000)
        event = {"messageId":str(uuid.uuid4()),"messageKind":"EVENT","messageType":"SettlementReserved","schemaVersion":1,"producer":"diagnostic","aggregateId":str(source_id),"aggregateVersion":2,"correlationId":str(uuid.uuid4()),"causationId":str(uuid.uuid4()),"requestId":str(uuid.uuid4()),"occurredAt":timezone.now().isoformat(),"payload":{"settlementId":str(saga.id),"sourceId":str(source_id),"sourceRevision":1,"state":"ACCEPTED","fence":1,"lockedAt":timezone.now().isoformat()}}
        from app.application.settlement_service import apply_query_settlement
        query = {**event, "messageId":str(uuid.uuid4()),"messageKind":"COMMAND","messageType":"QuerySettlement",
                 "payload":{"requestId":str(uuid.uuid4()),"settlementId":str(saga.id),
                    "sourceType":"LAB_ORDER","sourceId":str(source_id),"sourceRevision":1}}
        apply_query_settlement(query)
        unknown = BillingEventOutbox.objects.get(event_type="SettlementDecision").payload["payload"]
        self.assertEqual(unknown["state"], "UNKNOWN")
        apply_settlement_reserved(event)
        apply_settlement_reserved(event)
        payment.refresh_from_db()
        self.assertEqual(payment.state, "SUCCEEDED")
        self.assertEqual(Receipt.objects.count(), 1)
        decision = BillingEventOutbox.objects.filter(event_type="SettlementDecision").order_by("-created_at").first().payload["payload"]
        self.assertEqual(decision["state"], "SUCCEEDED")
        self.assertGreater(decision["decisionVersion"], unknown["decisionVersion"])
