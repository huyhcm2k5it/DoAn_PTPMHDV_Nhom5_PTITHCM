import uuid

from django.db import transaction

from app.application.refund_workflow import reconcile_source_cancellation
from app.domain.models import (
    CancellationEvidence,
    Charge,
    ChargeSource,
    MessageInbox,
)
from app.infrastructure.message_delivery import (
    digest,
    lock_source,
    positive_int,
    validate,
)


@transaction.atomic
def apply_source_cancellation(envelope):
    kind = envelope["messageType"]
    payload = validate(envelope, kind, "EVENT")

    owner = {
        "AppointmentChanged": "appointment",
        "LabCancelled": "diagnostic",
        "MedicationHoldChanged": "pharmacy",
    }.get(kind)

    if owner is None or envelope["producer"] != owner:
        raise ValueError("Cancellation owner mismatch")

    fingerprint = digest(payload)

    # Claim message trước mọi thay đổi nghiệp vụ.
    # Unique message_id cũng xử lý hai delivery đồng thời.
    inbox, created = MessageInbox.objects.get_or_create(
        message_id=envelope["messageId"],
        defaults={
            "handler": kind,
            "body_hash": fingerprint,
        },
    )

    if not created:
        if inbox.handler != kind or inbox.body_hash != fingerprint:
            raise ValueError("Message identity conflict")
        return inbox.state

    ignored = (
        kind == "AppointmentChanged"
        and payload.get("changeType")
        not in ("CANCELLED", "EXPIRED", "EXPIRED_LATE_PAID")
    ) or (
        kind == "MedicationHoldChanged"
        and payload.get("changeType") not in ("RELEASED", "EXPIRED")
    )

    if ignored:
        inbox.state = "IGNORED"
        inbox.save(update_fields=["state"])
        return "IGNORED"

    if kind == "LabCancelled" and payload.get("noSpecimen") is not True:
        raise ValueError("Cannot refund a sampled LAB")

    source_type = {
        "appointment": "APPOINTMENT",
        "diagnostic": "LAB_ORDER",
        "pharmacy": "MED_HOLD",
    }[owner]

    source_field = {
        "appointment": "appointmentId",
        "diagnostic": "orderId",
        "pharmacy": "holdId",
    }[owner]

    source_id = uuid.UUID(
        str(payload.get("sourceId") or payload[source_field])
    )
    cancellation_id = uuid.UUID(str(payload["cancellationId"]))

    if (
        payload.get("sourceType") is not None
        and payload["sourceType"] != source_type
    ):
        raise ValueError("Cancellation source type mismatch")

    if (
        payload.get(source_field) is not None
        and uuid.UUID(str(payload[source_field])) != source_id
    ):
        raise ValueError("Cancellation source identity mismatch")

    # Giữ cơ chế khóa Quân đã thêm; chuẩn hóa UUID trước khi hash khóa.
    lock_source(source_type, source_id)

    ChargeSource.objects.select_for_update().filter(
        source_type=source_type,
        source_id=source_id,
    ).first()

    revision = payload.get("cancelledSourceRevision")
    if revision is None:
        revision = payload.get("sourceRevision")
    if revision is None:
        revision = payload.get("attemptNo")

    if revision is None:
        # Chỉ tương thích event LAB cũ khi có đúng một charge.
        if kind != "LabCancelled":
            raise ValueError("Cancellation revision required")

        revisions = list(
            Charge.objects.filter(
                source_type=source_type,
                source_id=source_id,
            ).values_list("source_revision", flat=True)[:2]
        )

        if len(revisions) != 1:
            raise ValueError("Cancellation revision not resolved")

        revision = revisions[0]

    positive_int(revision)

    context = {
        "messageId": str(envelope["messageId"]),
        "requestId": envelope["requestId"],
        "correlationId": envelope["correlationId"],
        "reasonCode": payload.get("reasonCode"),
    }

    evidence, evidence_created = CancellationEvidence.objects.get_or_create(
        cancellation_id=cancellation_id,
        defaults={
            "source_type": source_type,
            "source_id": source_id,
            "source_revision": revision,
            "source_version": envelope["aggregateVersion"],
            "body_hash": fingerprint,
            "context": context,
        },
    )

    if not evidence_created:
        if (
            evidence.body_hash != fingerprint
            or evidence.source_type != source_type
            or evidence.source_id != source_id
            or evidence.source_revision != revision
            or evidence.source_version != envelope["aggregateVersion"]
        ):
            raise ValueError("Cancellation identity conflict")

        if not evidence.context:
            evidence.context = context
            evidence.save(update_fields=["context"])

    charge = (
        Charge.objects.select_for_update()
        .filter(
            source_type=source_type,
            source_id=source_id,
            source_revision=revision,
        )
        .first()
    )

    if charge is not None:
        reconcile_source_cancellation(charge, evidence)

    return "APPLIED"