"""Cancellation evidence is accepted only from the actual owner event."""
from django.db import transaction
from app.domain.models import CancellationEvidence, Charge, MessageInbox
from app.infrastructure.message_delivery import validate, digest, positive_int


@transaction.atomic
def apply_source_cancellation(envelope):
    kind = envelope["messageType"]
    p = validate(envelope,kind,"EVENT")
    owner = {"AppointmentChanged":"appointment","LabCancelled":"diagnostic",
             "MedicationHoldChanged":"pharmacy"}.get(kind)
    if envelope["producer"] != owner:
        raise ValueError("Cancellation owner mismatch")
    if kind == "AppointmentChanged" and p.get("changeType") != "CANCELLED":
        return "IGNORED"
    if kind == "MedicationHoldChanged" and p.get("changeType") not in ("RELEASED","EXPIRED"):
        return "IGNORED"
    if kind == "LabCancelled" and p.get("noSpecimen") is not True:
        raise ValueError("Cannot refund a sampled LAB")
    source_type = {"appointment":"APPOINTMENT","diagnostic":"LAB_ORDER","pharmacy":"MED_HOLD"}[owner]
    source_id = p.get("sourceId") or p.get("appointmentId") or p.get("orderId") or p.get("holdId")
    revision = p.get("cancelledSourceRevision") or p.get("sourceRevision") or p.get("attemptNo")
    if revision is None:
        # LabCancelled's current CSV omits revision. Require exactly one matching charge.
        charges = list(Charge.objects.filter(source_type=source_type,source_id=source_id))
        if len(charges) != 1:
            raise ValueError("Cancellation revision not resolved")
        revision = charges[0].source_revision
    positive_int(revision)
    fingerprint = digest(p)
    record, created = CancellationEvidence.objects.get_or_create(cancellation_id=p["cancellationId"], defaults={
        "source_type":source_type,"source_id":source_id,"source_revision":revision,
        "source_version":envelope["aggregateVersion"],"body_hash":fingerprint})
    if not created and record.body_hash != fingerprint:
        raise ValueError("Cancellation identity conflict")
    Charge.objects.filter(source_type=source_type,source_id=source_id,source_revision=revision,state="OPEN").update(state="VOID")
    MessageInbox.objects.get_or_create(message_id=envelope["messageId"],defaults={
        "handler":kind,"body_hash":fingerprint})
    return "APPLIED"
