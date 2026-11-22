import uuid
from unittest.mock import patch
from django.test import TestCase
from django.utils import timezone
from app.domain.models import Charge, ChargeSource, BillingEventOutbox, MessageInbox
from app.worker.consumer import handle_request_charge


def envelope(kind="RequestCharge", producer="appointment", payload=None):
    return {"messageId":str(uuid.uuid4()),"messageKind":"COMMAND","messageType":kind,"schemaVersion":1,"producer":producer,"aggregateId":str(uuid.uuid4()),"aggregateVersion":1,"correlationId":str(uuid.uuid4()),"causationId":None,"requestId":str(uuid.uuid4()),"occurredAt":timezone.now().isoformat(),"payload":payload or {"requestId":str(uuid.uuid4()),"sourceType":"APPOINTMENT","sourceId":str(uuid.uuid4()),"sourceRevision":1,"patientId":str(uuid.uuid4()),"recipientUserId":str(uuid.uuid4()),"amountVnd":1000,"linesSnapshot":[],"snapshotHash":"a"*64}}

class ChargeWireTests(TestCase):
    def test_same_source_revision_rejects_changed_immutable_fields_even_with_same_hash(self):
        first = envelope(payload={**envelope()["payload"], "expiresAt": "2026-11-23T01:00:00Z"})
        handle_request_charge(first)
        for changes in (
            {"amountVnd": 9000}, {"linesSnapshot": [{"quantity": 9}]},
            {"recipientUserId": str(uuid.uuid4())},
            {"expiresAt": "2026-11-23T01:01:00Z"}, {"expiresAt": None},
            {"snapshotHash": "b" * 64},
        ):
            with self.subTest(changes=changes):
                retry = envelope(payload={**first["payload"], **changes})
                with self.assertRaisesRegex(ValueError, "Source revision snapshot conflict"):
                    handle_request_charge(retry)
                charge = Charge.objects.get()
                self.assertEqual(charge.amount_vnd, 1000)
                self.assertEqual(charge.price_snapshot, [])
                self.assertEqual(BillingEventOutbox.objects.count(), 1)
                self.assertEqual(MessageInbox.objects.count(), 1)

    def test_new_request_with_identical_source_data_reuses_charge(self):
        first = envelope(payload={**envelope()["payload"], "expiresAt": "2026-11-23T01:00:00Z"})
        handle_request_charge(first)
        retry = envelope(payload={**first["payload"], "requestId": str(uuid.uuid4()),
                                  "expiresAt": "2026-11-23T08:00:00+07:00"})
        self.assertEqual(handle_request_charge(retry), "APPLIED")
        self.assertEqual(Charge.objects.count(), 1)
        self.assertEqual(BillingEventOutbox.objects.count(), 2)
        self.assertEqual(MessageInbox.objects.count(), 2)

    def test_canonical_envelope_creates_charge_and_duplicate_one_effect(self):
        event=envelope()
        with patch("app.worker.consumer.publish_charge_prepared",return_value=False):
            handle_request_charge(event);handle_request_charge(event)
        self.assertEqual(Charge.objects.count(),1)
        self.assertEqual(BillingEventOutbox.objects.count(),1)
        self.assertEqual(BillingEventOutbox.objects.get().payload["payload"]["state"],"CREATED")

    def test_source_owner_is_shared_across_revisions(self):
        first = envelope()
        handle_request_charge(first)
        revision = envelope(payload={**first["payload"], "sourceRevision": 2})
        handle_request_charge(revision)
        wrong_owner = envelope(payload={
            **first["payload"], "sourceRevision": 3, "patientId": str(uuid.uuid4()),
        })
        with self.assertRaisesRegex(ValueError, "Charge source patient conflict"):
            handle_request_charge(wrong_owner)
        self.assertEqual(ChargeSource.objects.count(), 1)
        self.assertEqual(Charge.objects.count(), 2)
