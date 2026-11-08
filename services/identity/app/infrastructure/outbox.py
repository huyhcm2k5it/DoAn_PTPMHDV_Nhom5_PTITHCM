import logging
import uuid
from django.utils import timezone
from app.domain.models import IdentityEventOutbox, StaffCapability

logger = logging.getLogger(__name__)

EXCHANGE_IDENTITY_EVENTS = "umc.events.identity.v1"
ROUTING_KEY_IDENTITY_ACCESS_CHANGED = "identity.identity-access-changed.v1"

def record_identity_access_changed(user, correlation_id=None, request_id=None, causation_id=None):
    """Ghi nhận sự kiện IdentityAccessChanged vào bảng Outbox theo cấu trúc Envelope chuẩn."""
    try:
        cid = str(correlation_id) if correlation_id else str(uuid.uuid4())
        req_id = str(request_id) if request_id else str(uuid.uuid4())
        cause_id = str(causation_id) if causation_id else req_id
        msg_id = str(uuid.uuid4())

        # Lấy danh sách capabilities đang kích hoạt của user
        capabilities = list(
            StaffCapability.objects.filter(user=user, enabled=True)
            .values_list("capability", flat=True)
        )

        envelope = {
            "messageId": msg_id,
            "messageKind": "EVENT",
            "messageType": "IdentityAccessChanged",
            "schemaVersion": 1,
            "producer": "identity",
            "aggregateId": str(user.id),
            "aggregateVersion": int(user.token_version),
            "correlationId": cid[:128],
            "causationId": cause_id,
            "requestId": req_id,
            "occurredAt": timezone.now().isoformat(),
            "payload": {
                "userId": str(user.id),
                "status": user.status,
                "actorType": user.actor_type,
                "capabilities": capabilities,
                "tokenVersion": int(user.token_version),
                "phoneVerified": user.phone_verified_at is not None,
                "version": int(user.token_version),
            }
        }

        outbox_entry = IdentityEventOutbox.objects.create(
            event_type="IdentityAccessChanged",
            exchange=EXCHANGE_IDENTITY_EVENTS,
            routing_key=ROUTING_KEY_IDENTITY_ACCESS_CHANGED,
            payload=envelope
        )
        logger.info(f"Đã tạo Outbox IdentityAccessChanged [{outbox_entry.id}] cho user {user.id} (tokenVersion={user.token_version})")

        # Thử publish trực tiếp nếu broker sẵn sàng
        try:
            from app.infrastructure.event_bus import publish_identity_event
            if publish_identity_event(EXCHANGE_IDENTITY_EVENTS, ROUTING_KEY_IDENTITY_ACCESS_CHANGED, envelope):
                outbox_entry.published_at = timezone.now()
                outbox_entry.save(update_fields=["published_at"])
        except Exception:
            pass

        return outbox_entry
    except Exception as e:
        logger.error(f"Lỗi khi ghi Outbox IdentityAccessChanged cho user {user.id}: {e}")
        return None
