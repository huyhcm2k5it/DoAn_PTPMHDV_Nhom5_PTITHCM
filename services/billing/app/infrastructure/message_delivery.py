"""Strict v1 envelope validation shared by local billing handlers."""
import hashlib
import json
import uuid
from django.utils import timezone

FIELDS = {"messageId", "messageKind", "messageType", "schemaVersion", "producer", "aggregateId", "aggregateVersion", "correlationId", "causationId", "requestId", "occurredAt", "payload"}
OWNERS = {"APPOINTMENT": "appointment", "LAB_ORDER": "diagnostic", "MED_HOLD": "pharmacy"}
MAX_SAFE_INTEGER = 9007199254740991


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def positive_int(value, minimum=1):
    if type(value) is not int or not minimum <= value <= MAX_SAFE_INTEGER:
        raise ValueError("Invalid integer")
    return value


def validate(envelope, message_type, kind=None):
    if not isinstance(envelope, dict) or set(envelope) != FIELDS:
        raise ValueError("Canonical envelope required")
    if envelope["schemaVersion"] != 1 or envelope["messageType"] != message_type or envelope["messageKind"] not in ("EVENT", "COMMAND"):
        raise ValueError("Unsupported envelope")
    if kind and envelope["messageKind"] != kind:
        raise ValueError("Wrong message kind")
    for key in ("messageId", "aggregateId"):
        uuid.UUID(str(envelope[key]))
    if not isinstance(envelope["correlationId"], str) or not 0 < len(envelope["correlationId"]) <= 128:
        raise ValueError("Invalid correlationId")
    positive_int(envelope["aggregateVersion"])
    if not isinstance(envelope["payload"], dict):
        raise ValueError("Object payload required")
    return envelope["payload"]


def make_envelope(message_type, payload, aggregate_id, version=1, kind="EVENT", cause=None):
    return {"messageId": str(uuid.uuid4()), "messageKind": kind, "messageType": message_type,
        "schemaVersion": 1, "producer": "billing", "aggregateId": str(aggregate_id),
        "aggregateVersion": version, "correlationId": (cause or {}).get("correlationId") or str(uuid.uuid4()),
        "causationId": (cause or {}).get("messageId") or str(uuid.uuid4()), "requestId": (cause or {}).get("requestId") or payload.get("requestId") or str(uuid.uuid4()),
        "occurredAt": timezone.now().isoformat(), "payload": payload}
