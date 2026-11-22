import hashlib
import json
import re
import uuid

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from app.domain.models import LegacyMessageInbox, MessageInbox, ReceivedMessage

REQUIRED = {"messageId", "messageKind", "messageType", "schemaVersion", "producer",
            "aggregateId", "aggregateVersion", "correlationId", "causationId",
            "requestId", "occurredAt", "payload"}
PRODUCERS = {"identity", "patient", "appointment", "catalog", "clinical",
             "diagnostic", "pharmacy", "billing", "notification"}


def validate_envelope(envelope):
    """Validate common wire fields before any inbox or projection write."""
    if not isinstance(envelope, dict) or set(envelope) != REQUIRED:
        raise ValueError("Invalid message envelope")
    if (envelope["messageKind"] not in ("EVENT", "COMMAND")
            or not isinstance(envelope["messageType"], str) or not envelope["messageType"]
            or type(envelope["schemaVersion"]) is not int or envelope["schemaVersion"] != 1
            or not isinstance(envelope["producer"], str) or envelope["producer"] not in PRODUCERS):
        raise ValueError("Unsupported message envelope")
    for key in ("messageId", "aggregateId", "requestId", "causationId"):
        value = envelope[key]
        if value is None and key in ("requestId", "causationId"):
            continue
        if not isinstance(value, str):
            raise ValueError("String UUID required")
        uuid.UUID(value)
    version = envelope["aggregateVersion"]
    if type(version) is not int or not 1 <= version <= 9007199254740991:
        raise ValueError("Invalid aggregate version")
    correlation = envelope["correlationId"]
    if not isinstance(correlation, str) or not 1 <= len(correlation) <= 128:
        raise ValueError("Invalid correlation ID")
    occurred = envelope["occurredAt"]
    if not isinstance(occurred, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})", occurred,
    ):
        raise ValueError("Invalid event timestamp")
    timestamp = parse_datetime(occurred.upper())
    if timestamp is None or not timezone.is_aware(timestamp):
        raise ValueError("Invalid event timestamp")
    if not isinstance(envelope["payload"], dict):
        raise ValueError("Object payload required")


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
