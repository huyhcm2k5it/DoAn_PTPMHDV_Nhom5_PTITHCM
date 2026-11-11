"""Persist minimal account access events in the same transaction as account changes."""
import uuid
from django.db import transaction
from django.utils import timezone
from app.domain.models import User, StaffCapability, IdentityOutbox


def wire_status(user):
    # Account storage uses a longer label; the event contract uses UNVERIFIED.
    return 'UNVERIFIED' if user.status == 'PENDING_VERIFICATION' else user.status


@transaction.atomic
def publish_access(user, bump=True):
    current = User.objects.select_for_update().get(id=user.id)
    if bump:
        current.access_version += 1
        current.save(update_fields=["access_version"])
    capabilities = list(StaffCapability.objects.filter(user=current,enabled=True).values_list("capability",flat=True))
    event = {
        "messageId":str(uuid.uuid4()), "messageKind":"EVENT","messageType":"IdentityAccessChanged",
        "schemaVersion":1,"producer":"identity","aggregateId":str(current.id),
        "aggregateVersion":current.access_version,"correlationId":str(uuid.uuid4()),
        "causationId":str(uuid.uuid4()),"requestId":str(uuid.uuid4()),"occurredAt":timezone.now().isoformat(),
        "payload":{"userId":str(current.id),"status":wire_status(current),"actorType":current.actor_type,
                   "capabilities":capabilities,"tokenVersion":current.token_version,
                   "phoneVerified":current.phone_verified_at is not None,"version":current.access_version},
    }
    IdentityOutbox.objects.get_or_create(aggregate_id=current.id,version=current.access_version,defaults={"envelope":event})
    user.access_version = current.access_version
    return event


def export_snapshot():
    """Owner-only CLI bootstrap: no password, OTP or phone leaves Identity."""
    rows=[]
    for user in User.objects.order_by("id"):
        rows.append({"userId":str(user.id),"status":wire_status(user),"actorType":user.actor_type,
                     "capabilities":list(user.capabilities.filter(enabled=True).values_list("capability",flat=True)),
                     "tokenVersion":user.token_version,"phoneVerified":user.phone_verified_at is not None,
                     "version":user.access_version})
    return rows
