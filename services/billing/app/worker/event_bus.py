import os
import json
import logging
from django.utils import timezone
import pika

logger = logging.getLogger(__name__)

RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "rabbitmq")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT", "5672"))
RABBITMQ_VHOST = os.getenv("RABBITMQ_VHOST", "/umc-care")

BILLING_EVENTS_EXCHANGE = "umc.events.billing.v1"
APPOINTMENT_COMMANDS_EXCHANGE = "umc.commands.appointment.v1"

def get_rabbitmq_connection():
    """Tạo kết nối tới RabbitMQ Broker.

    Biến môi trường được kiểm tra tại đây thay vì lúc import module, để module
    còn import được cho unit test và cho các lệnh không cần broker
    (migrate, test, kiểm tra cấu hình).
    """
    user = os.getenv("RABBITMQ_USER")
    password = os.getenv("RABBITMQ_PASSWORD")
    if not user or not password:
        raise RuntimeError("Biến môi trường RABBITMQ_USER và RABBITMQ_PASSWORD là bắt buộc và không được để trống.")
    credentials = pika.PlainCredentials(user, password)
    parameters = pika.ConnectionParameters(
        host=RABBITMQ_HOST,
        port=RABBITMQ_PORT,
        virtual_host=RABBITMQ_VHOST,
        credentials=credentials,
        heartbeat=60,
        blocked_connection_timeout=300
    )
    return pika.BlockingConnection(parameters)

def publish_event(exchange: str, routing_key: str, payload: dict):
    """Bắn event có cấu trúc JSON lên RabbitMQ Topic Exchange."""
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
                delivery_mode=2,  # Lưu bền vững trên đĩa (persistent)
                content_type="application/json"
            )
        )
        connection.close()
        logger.info(f"Published event [{routing_key}] to [{exchange}]: {message_body}")
        return True
    except Exception as exc:
        logger.warning(f"Không thể bắn event [{routing_key}] lên RabbitMQ: {exc}")
        return False

def publish_charge_prepared(request_id, source_type, source_id, source_revision, charge_id, state="CREATED"):
    """Bắn event ChargePrepared (dòng 19 trong 04_Events_18.csv)"""
    payload = {
        "requestId": str(request_id),
        "sourceType": source_type,
        "sourceId": str(source_id),
        "sourceRevision": source_revision,
        "chargeId": str(charge_id),
        "state": state,
        "reasonCode": None,
        "emittedAt": timezone.now().isoformat()
    }
    return publish_event(BILLING_EVENTS_EXCHANGE, "billing.charge-prepared.v1", payload)

def publish_charge_paid(charge, payment):
    """Bắn event ChargePaid (dòng 6 trong 04_Events_18.csv) để chốt lịch khám sang CONFIRMED"""
    payload = {
        "chargeId": str(charge.id),
        "sourceType": charge.source_type,
        "sourceId": str(charge.source_id),
        "sourceRevision": charge.source_revision,
        "settlementId": str(payment.id),
        "fence": "PAID",
        "transactionId": str(payment.transaction_id),
        "amountVnd": charge.amount_vnd,
        "paidAt": timezone.now().isoformat()
    }
    return publish_event(BILLING_EVENTS_EXCHANGE, "billing.charge-paid.v1", payload)