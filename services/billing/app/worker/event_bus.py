import os
import json
import logging
import uuid
from django.utils import timezone
import pika

logger = logging.getLogger(__name__)

RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "rabbitmq")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT", "5672"))
RABBITMQ_VHOST = os.getenv("RABBITMQ_VHOST", "/umc-care")

BILLING_EVENTS_EXCHANGE = "umc.events.billing.v1"
BILLING_COMMANDS_EXCHANGE = "umc.commands.billing.v1"
APPOINTMENT_COMMANDS_EXCHANGE = "umc.commands.appointment.v1"

def get_rabbitmq_connection():
    """Tạo kết nối tới RabbitMQ Broker."""
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
        blocked_connection_timeout=300,
        connection_attempts=1,
        socket_timeout=5.0
    )
    return pika.BlockingConnection(parameters)

def publish_event(exchange: str, routing_key: str, payload: dict) -> bool:
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

def publish_charge_prepared(request_id, source_type, source_id, source_revision, charge_id, state="CREATED") -> bool:
    """Bắn event ChargePrepared đóng gói Envelope chuẩn cho Appointment, Pharmacy, Diagnostic."""
    envelope = {
        "messageId": str(uuid.uuid4()),
        "messageKind": "EVENT",
        "messageType": "ChargePrepared",
        "schemaVersion": 1,
        "producer": "billing",
        "payload": {
            "requestId": str(request_id) if request_id else str(charge_id),
            "sourceType": str(source_type),
            "sourceId": str(source_id),
            "sourceRevision": int(source_revision),
            "chargeId": str(charge_id),
            "state": "CREATED" if state != "REJECTED" else "REJECTED",
            "reasonCode": ""
        }
    }
    return publish_event(BILLING_EVENTS_EXCHANGE, "billing.charge-prepared.v1", envelope)

def publish_settlement_reserved(charge, settlement_id, fence: int = 1, state: str = "ACCEPTED") -> bool:
    """Bắn event SettlementReserved (fence số nguyên dương >= 1)."""
    envelope = {
        "messageId": str(uuid.uuid4()),
        "messageKind": "EVENT",
        "messageType": "SettlementReserved",
        "schemaVersion": 1,
        "producer": "billing",
        "payload": {
            "settlementId": str(settlement_id),
            "chargeId": str(charge.id),
            "sourceType": str(charge.source_type),
            "sourceId": str(charge.source_id),
            "sourceRevision": int(charge.source_revision),
            "state": state,
            "fence": int(fence),
            "emittedAt": timezone.now().isoformat()
        }
    }
    return publish_event(BILLING_EVENTS_EXCHANGE, "billing.settlement-reserved.v1", envelope)

def publish_charge_paid(charge, payment, fence: int = 1) -> bool:
    """Bắn event ChargePaid đóng gói Envelope chuẩn (fence số nguyên dương >= 1)."""
    envelope = {
        "messageId": str(uuid.uuid4()),
        "messageKind": "EVENT",
        "messageType": "ChargePaid",
        "schemaVersion": 1,
        "producer": "billing",
        "payload": {
            "chargeId": str(charge.id),
            "sourceType": str(charge.source_type),
            "sourceId": str(charge.source_id),
            "sourceRevision": int(charge.source_revision),
            "settlementId": str(payment.id),
            "fence": int(fence),
            "transactionId": str(payment.transaction_id or payment.id),
            "amountVnd": int(charge.amount_vnd),
            "paidAt": timezone.now().isoformat()
        }
    }
    return publish_event(BILLING_EVENTS_EXCHANGE, "billing.charge-paid.v1", envelope)

def publish_settlement_decision(charge, payment, decision: str = "SUCCEEDED", fence: int = 1) -> bool:
    """Bắn event SettlementDecision cho Pharmacy/Diagnostic."""
    envelope = {
        "messageId": str(uuid.uuid4()),
        "messageKind": "EVENT",
        "messageType": "SettlementDecision",
        "schemaVersion": 1,
        "producer": "billing",
        "payload": {
            "chargeId": str(charge.id),
            "sourceType": str(charge.source_type),
            "sourceId": str(charge.source_id),
            "sourceRevision": int(charge.source_revision),
            "settlementId": str(payment.id),
            "decision": decision,
            "fence": int(fence),
            "transactionId": str(payment.transaction_id or payment.id),
            "amountVnd": int(charge.amount_vnd),
            "decidedAt": timezone.now().isoformat()
        }
    }
    return publish_event(BILLING_EVENTS_EXCHANGE, "billing.settlement-decision.v1", envelope)
