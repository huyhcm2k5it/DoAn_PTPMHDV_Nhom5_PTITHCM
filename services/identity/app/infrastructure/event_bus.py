import os
import json
import logging
from django.utils import timezone
import pika

logger = logging.getLogger(__name__)

RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "rabbitmq")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT", "5672"))
RABBITMQ_VHOST = os.getenv("RABBITMQ_VHOST", "/umc-care")

EXCHANGE_IDENTITY_EVENTS = "umc.events.identity.v1"
ROUTING_KEY_IDENTITY_ACCESS_CHANGED = "identity.identity-access-changed.v1"

def get_rabbitmq_connection():
    """Tạo kết nối tới RabbitMQ Broker cho Identity service."""
    user = os.getenv("RABBITMQ_USER")
    password = os.getenv("RABBITMQ_PASSWORD")
    if not user or not password:
        raise RuntimeError("Biến môi trường RABBITMQ_USER và RABBITMQ_PASSWORD là bắt buộc.")
    credentials = pika.PlainCredentials(user, password)
    parameters = pika.ConnectionParameters(
        host=RABBITMQ_HOST,
        port=RABBITMQ_PORT,
        virtual_host=RABBITMQ_VHOST,
        credentials=credentials,
        heartbeat=60,
        blocked_connection_timeout=300,
        connection_attempts=1,
        socket_timeout=5.0
    )
    return pika.BlockingConnection(parameters)

def publish_identity_event(exchange: str, routing_key: str, payload: dict) -> bool:
    """Publish event lên RabbitMQ Exchange."""
    try:
        connection = get_rabbitmq_connection()
        channel = connection.channel()
        channel.exchange_declare(exchange=exchange, exchange_type="topic", durable=True)

        message_body = json.dumps(payload, ensure_ascii=False)
        channel.basic_publish(
            exchange=exchange,
            routing_key=routing_key,
            body=message_body.encode("utf-8"),
            properties=pika.BasicProperties(
                delivery_mode=2,  # Persistent
                content_type="application/json"
            )
        )
        connection.close()
        return True
    except Exception as e:
        logger.warning(f"Không thể publish event lên RabbitMQ ({exchange}/{routing_key}): {e}")
        return False

def drain_identity_outbox(max_batch: int = 20):
    """Quét và gửi các sự kiện outbox chưa được gửi."""
    from app.domain.models import IdentityEventOutbox

    pending_records = (
        IdentityEventOutbox.objects.filter(published_at__isnull=True)
        .order_by("created_at")[:max_batch]
    )
    if not pending_records:
        return 0

    sent_count = 0
    try:
        connection = get_rabbitmq_connection()
        channel = connection.channel()
        for record in pending_records:
            channel.exchange_declare(exchange=record.exchange, exchange_type="topic", durable=True)
            body = json.dumps(record.payload, ensure_ascii=False).encode("utf-8")
            channel.basic_publish(
                exchange=record.exchange,
                routing_key=record.routing_key,
                body=body,
                properties=pika.BasicProperties(
                    delivery_mode=2,
                    content_type="application/json"
                )
            )
            record.published_at = timezone.now()
            record.save(update_fields=["published_at"])
            sent_count += 1
        connection.close()
    except Exception as exc:
        logger.warning(f"Lỗi khi drain identity outbox: {exc}")

    return sent_count
