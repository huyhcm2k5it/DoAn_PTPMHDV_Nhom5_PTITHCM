import uuid
from django.db import transaction
from django.utils.dateparse import parse_datetime
from app.domain.models import Charge, BillingEventOutbox, MessageInbox
from app.infrastructure.message_delivery import validate, digest, positive_int, make_envelope, OWNERS


@transaction.atomic
def handle_request_charge(envelope, delivery_context=None):
    payload = validate(envelope, "RequestCharge", "COMMAND")
    source = payload.get("sourceType")
    if OWNERS.get(source) != envelope["producer"]:
        raise ValueError("Wrong source producer")
    for key in ("sourceId", "patientId", "recipientUserId"):
        uuid.UUID(str(payload[key]))
    positive_int(payload["sourceRevision"])
    positive_int(payload["amountVnd"], 0)
    fingerprint = digest(payload)
    inbox = MessageInbox.objects.select_for_update().filter(message_id=envelope["messageId"]).first()
    if inbox:
        if inbox.body_hash != fingerprint:
            raise ValueError("Message identity conflict")
        return "DUPLICATE"
    snapshot = {key: payload.get(key) for key in ("patientId", "recipientUserId", "amountVnd", "linesSnapshot", "expiresAt")}
    snapshot_hash = payload.get("snapshotHash")
    if not isinstance(snapshot_hash, str) or len(snapshot_hash) != 64 or any(c not in "0123456789abcdef" for c in snapshot_hash):
        raise ValueError("Immutable owner snapshotHash required")
    charge, created = Charge.objects.select_for_update().get_or_create(
        source_type=source, source_id=payload["sourceId"], source_revision=payload["sourceRevision"],
        defaults={"patient_id":payload["patientId"], "recipient_user_id":payload["recipientUserId"],
            "amount_vnd":payload["amountVnd"], "price_snapshot":payload.get("linesSnapshot", []),
            "snapshot_hash":snapshot_hash, "expires_at":parse_datetime(payload["expiresAt"]) if payload.get("expiresAt") else None})
    if not created and charge.snapshot_hash != snapshot_hash:
        raise ValueError("Source revision snapshot conflict")
    response = {"requestId":payload.get("requestId") or envelope["requestId"], "sourceType":source,
        "sourceId":str(charge.source_id), "sourceRevision":charge.source_revision,
        "chargeId":str(charge.id), "state":"CREATED", "reasonCode":None}
    BillingEventOutbox.objects.create(event_type="ChargePrepared", exchange="umc.events.billing.v1",
        routing_key="billing.charge-prepared.v1", payload=make_envelope("ChargePrepared",response,charge.id,charge.version,cause=envelope))
    MessageInbox.objects.create(message_id=envelope["messageId"],handler="RequestCharge",body_hash=fingerprint)
    return "APPLIED"
