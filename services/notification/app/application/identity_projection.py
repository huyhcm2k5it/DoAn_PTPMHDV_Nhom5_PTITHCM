"""Transactional, monotonic Identity projection and durable inbox handling."""
import uuid
from django.db import transaction
from django.utils.dateparse import parse_datetime
from app.application.messages import digest, receive, validate_envelope
from app.domain.models import IdentityAccessProjection

PAYLOAD_FIELDS = {'userId', 'status', 'actorType', 'capabilities', 'tokenVersion', 'phoneVerified', 'version'}


def positive_int(value):
    return type(value) is int and 0 < value <= 9007199254740991


def wire_uuid(value):
    if not isinstance(value, str):
        raise ValueError("String UUID required")
    return uuid.UUID(value)


def validate(envelope):
    validate_envelope(envelope)
    if (envelope['messageKind'] != 'EVENT' or envelope['messageType'] != 'IdentityAccessChanged'
            or envelope['producer'] != 'identity' or type(envelope['schemaVersion']) is not int
            or envelope['schemaVersion'] != 1 or not positive_int(envelope['aggregateVersion'])):
        raise ValueError('Untrusted identity event')
    for key in ('messageId', 'aggregateId'):
        wire_uuid(envelope[key])
    for key in ('requestId', 'causationId'):
        if envelope[key] is not None:
            wire_uuid(envelope[key])
    correlation = envelope['correlationId']
    occurred = envelope['occurredAt']
    if not isinstance(correlation, str) or not 1 <= len(correlation) <= 128:
        raise ValueError('Invalid correlation ID')
    if not isinstance(occurred, str) or parse_datetime(occurred) is None:
        raise ValueError('Invalid event timestamp')
    payload = envelope['payload']
    if not isinstance(payload, dict) or (set(payload) - {'phone'}) != PAYLOAD_FIELDS:
        raise ValueError('Invalid identity payload')
    if 'phone' in payload and (not isinstance(payload['phone'], str) or not 8 <= len(payload['phone']) <= 20):
        raise ValueError('Invalid optional phone')
    user_id = wire_uuid(payload['userId'])
    if (user_id != wire_uuid(envelope['aggregateId']) or not positive_int(payload['version'])
            or payload['version'] != envelope['aggregateVersion'] or not positive_int(payload['tokenVersion'])
            or payload['status'] not in ('UNVERIFIED', 'ACTIVE', 'LOCKED', 'BLOCKED')
            or payload['actorType'] not in ('PATIENT', 'STAFF', 'DOCTOR')
            or type(payload['phoneVerified']) is not bool
            or not isinstance(payload['capabilities'], list)
            or any(not isinstance(item, str) for item in payload['capabilities'])):
        raise ValueError('Invalid identity state')
    return payload


@transaction.atomic
def apply_identity_access(envelope):
    payload = validate(envelope)
    if receive(envelope, "identity_access") is None:
        return 'REPLAYED'
    # Create the row before locking so concurrent first deliveries serialize too.
    IdentityAccessProjection.objects.get_or_create(user_id=payload['userId'])
    row = IdentityAccessProjection.objects.select_for_update().get(user_id=payload['userId'])
    payload_hash = digest(payload)
    if payload['version'] < row.version:
        return 'STALE'
    if payload['version'] == row.version:
        if row.body_hash != payload_hash:
            raise ValueError('Identity projection version conflict')
        return 'REPLAYED'
    if payload['tokenVersion'] < row.token_version:
        raise ValueError('Identity token version cannot decrease')
    row.version = payload['version']
    row.token_version = payload['tokenVersion']
    row.status = payload['status']
    row.actor_type = payload['actorType']
    row.capabilities = payload['capabilities']
    row.phone_verified = payload['phoneVerified']
    row.body_hash = payload_hash
    row.save()
    return 'APPLIED'
