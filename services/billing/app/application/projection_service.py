"""Owner-scoped, monotonic Patient access projection for Billing."""
from django.db import transaction
from app.domain.models import PatientAccessProjection, MessageInbox
from app.infrastructure.message_delivery import validate, digest, positive_int


@transaction.atomic
def apply_patient_access(envelope):
    p = validate(envelope, "PatientAccessChanged", "EVENT")
    if envelope["producer"] != "patient":
        raise ValueError("Patient owner required")
    version = positive_int(p["policyVersion"])
    row = PatientAccessProjection.objects.select_for_update().filter(patient_id=p["patientId"]).first()
    fingerprint = digest(p)
    if row and version < row.version:
        return "STALE"
    if row and version == row.version:
        if row.body_hash != fingerprint:
            raise ValueError("Patient projection version conflict")
        return "REPLAYED"
    PatientAccessProjection.objects.update_or_create(patient_id=p["patientId"], defaults={
        "owner_user_id":p["ownerUserId"],"version":version,
        "active":p["active"],"body_hash":fingerprint})
    MessageInbox.objects.get_or_create(message_id=envelope["messageId"],defaults={
        "handler":"PatientAccessChanged","body_hash":fingerprint})
    return "APPLIED"
