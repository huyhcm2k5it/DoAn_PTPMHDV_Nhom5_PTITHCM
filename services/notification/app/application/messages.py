import hashlib
import json

from app.domain.models import LegacyMessageInbox, MessageInbox, ReceivedMessage


def digest(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def receive(envelope, consumer_name):
    """Register a validated envelope inside the caller's processing transaction."""
    message_id = envelope["messageId"]
    fingerprint = digest(envelope)
    legacy = LegacyMessageInbox.objects.filter(pk=message_id).first()
    if legacy:
        if legacy.body_hash != fingerprint:
            raise ValueError("Duplicate message content conflict")
        return None
    message, _ = ReceivedMessage.objects.get_or_create(
        message_id=message_id,
        defaults={
            "payload_hash": fingerprint,
            "source_aggregate_id": envelope["aggregateId"],
            "source_version": envelope["aggregateVersion"],
        },
    )
    if message.payload_hash != fingerprint:
        raise ValueError("Duplicate message content conflict")
    inbox, created = MessageInbox.objects.get_or_create(
        message=message, consumer_name=consumer_name,
    )
    return inbox if created else None
