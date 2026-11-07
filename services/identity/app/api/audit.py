"""Ghi vết an ninh vào bảng AuditEvent (NFR-06)."""

import uuid

from app.domain.models import AuditEvent


def record_audit(action, correlation_id, actor_user_id=None, target_id=None, detail=None):
    """correlationId từ header có thể không phải UUID nên phải chuẩn hoá."""
    try:
        correlation_uuid = uuid.UUID(str(correlation_id))
    except (ValueError, TypeError):
        correlation_uuid = uuid.uuid4()
    AuditEvent.objects.create(
        action=action,
        actor_user_id=actor_user_id,
        target_id=target_id,
        before_after=detail or {},
        correlation_id=correlation_uuid,
    )
