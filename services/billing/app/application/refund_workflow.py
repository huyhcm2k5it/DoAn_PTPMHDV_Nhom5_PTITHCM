import uuid

from app.domain.models import (
    BillingAuditEvent,
    BillingEventOutbox,
    CancellationEvidence,
    Refund,
)
from app.infrastructure.message_delivery import make_envelope

def enqueue_refund_status(charge, refund, correlation_id):
    # Call inside the transaction holding the charge lock.
    charge.version += 1
    charge.save(update_fields=["version", "updated_at"])
    if not charge.recipient_user_id:
        return
    payload = {
        "chargeId": str(charge.id),
        "recipientUserId": str(charge.recipient_user_id),
        "refundId": str(refund.id),
        "sourceId": str(charge.source_id),
        "sourceType": charge.source_type,
        "refundStatus": refund.state,
        "state": "REFUNDED" if refund.state == "SUCCEEDED" else charge.state,
        "version": charge.version,
    }
    BillingEventOutbox.objects.create(
        event_type="BillingStatusChanged",
        exchange="umc.events.billing.v1",
        routing_key="billing.billing-status-changed.v1",
        payload=make_envelope(
            "BillingStatusChanged", payload, charge.id, charge.version,
            cause={"correlationId": correlation_id},
        ),
    )

def record_audit(action, actor_user_id, target_id, payload, correlation_id):
    """Ghi vết nghiệp vụ tiền.

    BI-007 quy định reasonCode "được ghi vào audit"; bảng BillingAuditEvent là
    nơi lưu vết đó, tách khỏi audit an ninh của Identity.
    """
    actor = None
    if actor_user_id:
        try:
            actor = uuid.UUID(str(actor_user_id))
        except (ValueError, TypeError):
            actor = None
    BillingAuditEvent.objects.create(
        action=action,
        actor_user_id=actor,
        target_id=target_id,
        payload=payload,
        correlation_id=str(correlation_id)[:64],
    )

ACTIVE_SETTLEMENT_STATES = ("REQUESTED", "RESERVED", "IN_DOUBT")


class RefundPolicyError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def ensure_refund_requested(
    charge,
    evidence,
    *,
    requested_amount=None,
    reason_code="SOURCE_CANCELLED",
    actor_user_id=None,
):
    """
    Caller phải giữ khóa charge trong transaction hiện tại.
    FAILED vẫn giữ phần tiền đã phân bổ vì BI-008 cho retry refund cũ.
    """
    if (
        evidence.source_type != charge.source_type
        or evidence.source_id != charge.source_id
        or evidence.source_revision != charge.source_revision
    ):
        raise RefundPolicyError(
            "CANCELLATION_EVIDENCE_REQUIRED",
            "Cancellation evidence does not match the charge.",
        )

    if charge.state != "PAID":
        raise RefundPolicyError(
            "REFUND_NOT_ELIGIBLE",
            "Charge must be PAID.",
        )

    if charge.sagas.filter(state__in=ACTIVE_SETTLEMENT_STATES).exists():
        raise RefundPolicyError(
            "REFUND_NOT_ELIGIBLE",
            "Settlement has not reached a final decision.",
        )

    refunds = list(
        Refund.objects.filter(charge=charge).order_by("updated_at", "id")
    )

    if any(
        refund.state not in ("REQUESTED", "SUCCEEDED", "FAILED")
        or refund.amount_vnd < 0
        for refund in refunds
    ):
        raise RefundPolicyError(
            "REFUND_RECONCILIATION_REQUIRED",
            "Existing refund data requires reconciliation.",
        )

    allocated = sum(refund.amount_vnd for refund in refunds)

    if allocated > charge.amount_vnd:
        raise RefundPolicyError(
            "REFUND_EXCEEDS_PAID",
            "Existing refunds exceed the paid amount.",
        )

    same_cancellation = [
        refund
        for refund in refunds
        if refund.cancellation_id == evidence.cancellation_id
    ]

    if same_cancellation:
        # Không dùng reasonCode làm cách tạo thêm refund cho cùng lần hủy.
        if len(same_cancellation) != 1 or allocated < charge.amount_vnd:
            raise RefundPolicyError(
                "REFUND_RECONCILIATION_REQUIRED",
                "Legacy partial refunds require reconciliation.",
            )

        refund = same_cancellation[0]

        if (
            requested_amount is not None
            and requested_amount != refund.amount_vnd
        ):
            raise RefundPolicyError(
                "REFUND_CONFLICT",
                "Existing refund has a different amount.",
            )

        return refund

    remaining = charge.amount_vnd - allocated

    if remaining == 0:
        if requested_amount is not None:
            raise RefundPolicyError(
                "REFUND_NOT_ELIGIBLE",
                "No unallocated amount remains.",
            )
        return None

    if requested_amount is not None and requested_amount != remaining:
        raise RefundPolicyError(
            "REFUND_EXCEEDS_PAID"
            if requested_amount > remaining
            else "REFUND_FULL_AMOUNT_REQUIRED",
            "Refund must equal the entire unallocated amount.",
        )

    refund = Refund.objects.create(
        charge=charge,
        cancellation_id=evidence.cancellation_id,
        reason_code=reason_code,
        amount_vnd=remaining,
        state="REQUESTED",
        attempts=[],
        version=1,
    )

    context = evidence.context or {}
    correlation_id = context.get("correlationId", "")

    enqueue_refund_status(charge, refund, correlation_id)

    record_audit(
        "REFUND_REQUESTED",
        actor_user_id,
        refund.id,
        {
            "chargeId": str(charge.id),
            "cancellationId": str(evidence.cancellation_id),
            "reasonCode": reason_code,
            "ownerReasonCode": context.get("reasonCode"),
            "amountVnd": remaining,
            "trigger": (
                "OWNER_CANCELLATION"
                if actor_user_id is None
                else "BI-007"
            ),
            "ownerMessageId": context.get("messageId"),
        },
        correlation_id,
    )

    return refund


def reconcile_source_cancellation(charge, evidence=None):
    """Caller phải giữ khóa charge trong transaction hiện tại."""
    if evidence is None:
        evidence = (
            CancellationEvidence.objects.filter(
                source_type=charge.source_type,
                source_id=charge.source_id,
                source_revision=charge.source_revision,
            )
            .order_by("source_version", "cancellation_id")
            .first()
        )

    if evidence is None:
        return "NO_CANCELLATION"

    if charge.sagas.filter(state__in=ACTIVE_SETTLEMENT_STATES).exists():
        return "DEFERRED"

    if charge.state == "PAID":
        refund = ensure_refund_requested(charge, evidence)
        return "REFUND_REQUESTED" if refund else "NO_REFUND_REQUIRED"

    if charge.state == "OPEN":
        charge.state = "VOID"
        charge.version += 1
        charge.save(update_fields=["state", "version", "updated_at"])

        record_audit(
            "CHARGE_VOIDED",
            None,
            charge.id,
            {
                "cancellationId": str(evidence.cancellation_id),
                "sourceRevision": charge.source_revision,
            },
            (evidence.context or {}).get("correlationId", ""),
        )

    return "APPLIED"