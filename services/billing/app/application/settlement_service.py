"""Only a matching source reservation authorizes a payment commit."""
from django.db import transaction
from django.utils import timezone
from app.domain.models import BillingEventOutbox


def drain_outbox():
    from app.worker.event_bus import publish_event
    for entry in BillingEventOutbox.objects.filter(published_at__isnull=True).order_by("created_at")[:50]:
        if publish_event(entry.exchange, entry.routing_key, entry.payload):
            entry.published_at = timezone.now()
        entry.attempts += 1
        entry.save(update_fields=["published_at", "attempts"])


def decision_payload(saga, payment=None):
    result = {"settlementId": str(saga.id), "sourceId": str(saga.source_id),
              "sourceRevision": saga.source_revision, "decisionVersion": saga.decision_version,
              "state": saga.state if saga.state in ("SUCCEEDED", "FAILED") else "UNKNOWN"}
    if saga.fence is not None:
        result["fence"] = saga.fence
    if payment and saga.state == "SUCCEEDED":
        result["paymentId"] = str(payment.id)
    return result


def enqueue_decision(saga, payment=None, cause=None):
    from app.infrastructure.message_delivery import make_envelope
    return BillingEventOutbox.objects.create(
        event_type="SettlementDecision", exchange="umc.events.billing.v1",
        routing_key="billing.settlement-decision.v1",
        payload=make_envelope("SettlementDecision", decision_payload(saga, payment),
                              saga.id, saga.decision_version, cause=cause))


@transaction.atomic
def apply_settlement_reserved(envelope):
    from app.domain.models import Charge, Payment, Receipt, SettlementSaga, MessageInbox
    from app.infrastructure.message_delivery import validate, digest, positive_int, make_envelope, OWNERS
    payload = validate(envelope, "SettlementReserved", "EVENT")
    saga = SettlementSaga.objects.select_for_update().get(id=payload["settlementId"])
    charge = Charge.objects.select_for_update().get(id=saga.charge_id)
    if envelope["producer"] != OWNERS.get(saga.source_type):
        raise ValueError("Wrong source producer")
    if payload.get("sourceId") != str(saga.source_id) or payload.get("sourceRevision") != saga.source_revision:
        raise ValueError("Reservation source mismatch")
    # CSV04's response contains sourceId/revision/state/fence, not the request's fields.
    # Validate extensions when present; never require undocumented fields to commit.
    for key, value in {"chargeId":str(charge.id), "sourceType":saga.source_type,
                       "attemptVersion":saga.version, "amountHash":saga.amount_hash}.items():
        if key in payload and payload[key] != value:
            raise ValueError("Reservation attempt mismatch")
    fingerprint = digest(payload)
    inbox = MessageInbox.objects.filter(message_id=envelope["messageId"]).first()
    if inbox:
        if inbox.body_hash != fingerprint:
            raise ValueError("Message identity conflict")
        return "DUPLICATE"
    payment = Payment.objects.select_for_update().get(saga=saga)
    if saga.state in ("FAILED", "SUCCEEDED"):
        if saga.state == "SUCCEEDED" and payload.get("fence") != saga.fence:
            raise ValueError("Fence conflict")
        enqueue_decision(saga, payment, envelope)
    else:
        state = payload.get("state")
        if state not in ("ACCEPTED", "REJECTED") or payment.state != "PENDING":
            raise ValueError("Invalid reservation state")
        now = timezone.now()
        saga.decision_version += 1
        if state == "REJECTED":
            saga.state = "FAILED"
            payment.state = "FAILED"
            charge.settlement_state = "FAILED"
            payment.save(update_fields=["state"])
        else:
            fence = positive_int(payload.get("fence"))
            if charge.state != "OPEN":
                raise ValueError("Charge is not open")
            saga.fence = fence
            saga.state = "SUCCEEDED"
            payment.state = "SUCCEEDED"
            payment.fence = fence
            payment.settlement_id = saga.id
            payment.paid_at = now
            payment.save(update_fields=["state", "fence", "settlement_id", "paid_at"])
            charge.state = "PAID"
            charge.settlement_state = "SUCCEEDED"
            charge.settlement_id = saga.id
            Receipt.objects.get_or_create(payment=payment, defaults={
                "charge":charge, "receipt_no":"REC-"+payment.id.hex.upper(),
                "amount_vnd":charge.amount_vnd})
            paid = {"chargeId":str(charge.id), "sourceType":charge.source_type,
                    "sourceId":str(charge.source_id), "sourceRevision":charge.source_revision,
                    "settlementId":str(saga.id), "fence":fence,
                    "transactionId":payment.transaction_id, "amountVnd":charge.amount_vnd,
                    "paidAt":now.isoformat()}
            BillingEventOutbox.objects.create(
                event_type="ChargePaid", exchange="umc.events.billing.v1",
                routing_key="billing.charge-paid.v1",
                payload=make_envelope("ChargePaid",paid,saga.id,saga.decision_version,cause=envelope))
        saga.save(update_fields=["fence","state","updated_at","decision_version"])
        charge.version += 1
        charge.save(update_fields=["state","settlement_state","settlement_id","updated_at","version"])
        enqueue_decision(saga, payment, envelope)
    MessageInbox.objects.create(message_id=envelope["messageId"],
                                handler="SettlementReserved", body_hash=fingerprint)
    return "APPLIED"


@transaction.atomic
def apply_query_settlement(envelope):
    from app.domain.models import SettlementSaga, Payment, MessageInbox
    from app.infrastructure.message_delivery import validate, digest, OWNERS
    p = validate(envelope, "QuerySettlement", "COMMAND")
    saga = SettlementSaga.objects.select_for_update().get(id=p["settlementId"])
    if (envelope["producer"] != OWNERS.get(saga.source_type)
            or p.get("sourceType") != saga.source_type
            or p.get("sourceId") != str(saga.source_id)
            or p.get("sourceRevision") != saga.source_revision):
        raise ValueError("Settlement query source mismatch")
    fingerprint = digest(p)
    prior = MessageInbox.objects.filter(message_id=envelope["messageId"]).first()
    if prior and prior.body_hash != fingerprint:
        raise ValueError("Message identity conflict")
    # A repeated query must re-publish the current authoritative decision.
    enqueue_decision(saga, Payment.objects.filter(saga=saga).first(), envelope)
    if not prior:
        MessageInbox.objects.create(message_id=envelope["messageId"],
                                    handler="QuerySettlement",body_hash=fingerprint)


@transaction.atomic
def mark_in_doubt(now=None):
    from app.domain.models import SettlementSaga
    now = now or timezone.now()
    # QuerySettlement travels source -> Billing. Billing never invents a sixth command.
    return SettlementSaga.objects.filter(state="REQUESTED", deadline_at__lte=now).update(
        state="IN_DOUBT", updated_at=now)
