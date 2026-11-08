import json
import logging
import time
import uuid
import pika
from django.db import transaction
from django.utils import timezone
from app.domain.models import Charge, Payment, Receipt, SettlementSaga, BillingEventOutbox
from app.worker.event_bus import (
    get_rabbitmq_connection,
    publish_charge_prepared,
    publish_charge_paid,
    publish_settlement_reserved,
    publish_settlement_decision,
    BILLING_EVENTS_EXCHANGE,
    BILLING_COMMANDS_EXCHANGE,
    APPOINTMENT_COMMANDS_EXCHANGE,
)

logger = logging.getLogger(__name__)

BILLING_COMMAND_QUEUE = "cmd.billing.v1"
ROUTING_KEY_REQUEST_CHARGE = "billing.request-charge.v1"

def handle_request_charge(raw_data: dict):
    """Xử lý command RequestCharge: hỗ trợ cả envelope lẫn raw payload."""
    payload = raw_data.get("payload", raw_data) if isinstance(raw_data, dict) else {}

    request_id = payload.get("requestId")
    source_type = payload.get("sourceType", "APPOINTMENT")
    source_id = payload.get("sourceId")
    source_revision = payload.get("sourceRevision", 1)
    patient_id = payload.get("patientId")
    amount_vnd = payload.get("amountVnd", 0)
    lines_snapshot = payload.get("linesSnapshot", [])
    snapshot_hash = payload.get("snapshotHash", "")

    if not source_id or not patient_id:
        logger.error(f"RequestCharge thiếu sourceId hoặc patientId: {payload}")
        return

    # Idempotent: Kiểm tra xem đã tạo Charge cho revision này chưa
    with transaction.atomic():
        charge, created = Charge.objects.get_or_create(
            source_type=source_type,
            source_id=source_id,
            source_revision=source_revision,
            defaults={
                "patient_id": patient_id,
                "amount_vnd": amount_vnd,
                "state": "OPEN",
                "price_snapshot": lines_snapshot,
                "snapshot_hash": snapshot_hash,
                "settlement_state": "NONE"
            }
        )

        prepared_payload = {
            "requestId": str(request_id) if request_id else str(charge.id),
            "sourceType": source_type,
            "sourceId": str(source_id),
            "sourceRevision": source_revision,
            "chargeId": str(charge.id),
            "state": "CREATED" if created else "CREATED",
            "reasonCode": "",
            "emittedAt": timezone.now().isoformat()
        }

        outbox = BillingEventOutbox.objects.create(
            event_type="ChargePrepared",
            exchange=BILLING_EVENTS_EXCHANGE,
            routing_key="billing.charge-prepared.v1",
            payload={
                "messageId": str(uuid.uuid4()),
                "messageKind": "EVENT",
                "messageType": "ChargePrepared",
                "schemaVersion": 1,
                "producer": "billing",
                "payload": prepared_payload
            }
        )

    action = "Tạo mới" if created else "Tái sử dụng"
    logger.info(f"{action} Charge {charge.id} cho {source_type} {source_id} (Rev {source_revision}), Outbox {outbox.id}")

    # Bắn phản hồi nghiệp vụ ChargePrepared
    if publish_charge_prepared(
        request_id=request_id,
        source_type=source_type,
        source_id=source_id,
        source_revision=source_revision,
        charge_id=charge.id,
        state="CREATED"
    ):
        outbox.published_at = timezone.now()
        outbox.save(update_fields=["published_at"])

def handle_reserve_settlement(raw_data: dict):
    """Xử lý command ReserveSettlement từ nguồn (Appointment, Pharmacy, Diagnostic)."""
    payload = raw_data.get("payload", raw_data) if isinstance(raw_data, dict) else {}

    settlement_id = payload.get("settlementId") or str(uuid.uuid4())
    charge_id = payload.get("chargeId")
    source_type = payload.get("sourceType")
    source_id = payload.get("sourceId")
    source_revision = payload.get("sourceRevision", 1)

    if not charge_id:
        logger.error(f"ReserveSettlement thiếu chargeId: {payload}")
        return

    with transaction.atomic():
        charge = Charge.objects.select_for_update().filter(id=charge_id).first()
        if not charge:
            logger.warning(f"ReserveSettlement: Không tìm thấy Charge {charge_id}")
            return

        if charge.state != "OPEN":
            logger.warning(f"ReserveSettlement: Charge {charge_id} không ở trạng thái OPEN ({charge.state})")
            return

        charge.settlement_state = "REQUESTED"
        charge.save(update_fields=["settlement_state", "updated_at"])

        # Tạo Outbox SettlementReserved
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
                "state": "ACCEPTED",
                "fence": 1,
                "emittedAt": timezone.now().isoformat()
            }
        }

        outbox = BillingEventOutbox.objects.create(
            event_type="SettlementReserved",
            exchange=BILLING_EVENTS_EXCHANGE,
            routing_key="billing.settlement-reserved.v1",
            payload=envelope
        )

    logger.info(f"Đã reserve settlement cho Charge {charge.id}, settlementId={settlement_id}")
    if publish_settlement_reserved(charge, settlement_id, fence=1, state="ACCEPTED"):
        outbox.published_at = timezone.now()
        outbox.save(update_fields=["published_at"])

def process_pending_settlements():
    """Tự động xử lý đối soát cho các khoản thanh toán đang PENDING."""
    pending_payment_ids = list(
        Payment.objects.filter(state="PENDING", method__in=("SIMULATION", "COUNTER"))
        .order_by("attempted_at")
        .values_list("id", flat=True)[:50]
    )
    for payment_id in pending_payment_ids:
        with transaction.atomic():
            payment = Payment.objects.select_for_update(skip_locked=True).filter(id=payment_id, state="PENDING").first()
            if not payment:
                continue

            charge = payment.charge
            # Chỉ đối soát khi charge còn hợp lệ (OPEN hoặc settlement đang REQUESTED)
            if charge.state not in ("OPEN", "PENDING"):
                logger.warning(f"Charge {charge.id} không hợp lệ để chốt thanh toán (state={charge.state})")
                payment.state = "FAILED"
                payment.save(update_fields=["state"])
                continue

            now = timezone.now()
            payment.state = "SUCCEEDED"
            payment.paid_at = now
            payment.save(update_fields=["state", "paid_at"])

            charge.state = "PAID"
            charge.settlement_state = "SUCCEEDED"
            charge.save(update_fields=["state", "settlement_state", "updated_at"])

            if payment.saga:
                payment.saga.state = "SUCCEEDED"
                payment.saga.save(update_fields=["state", "updated_at"])

            receipt_no = f"REC-{now.strftime('%Y%m%d')}-{payment.id.hex[:8].upper()}"
            Receipt.objects.get_or_create(
                payment=payment,
                defaults={
                    "charge": charge,
                    "receipt_no": receipt_no,
                    "amount_vnd": charge.amount_vnd
                }
            )

            # Đóng gói ChargePaid envelope chuẩn với fence số nguyên dương 1
            charge_paid_envelope = {
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
                    "fence": 1,
                    "transactionId": str(payment.transaction_id or payment.id),
                    "amountVnd": int(charge.amount_vnd),
                    "paidAt": now.isoformat()
                }
            }

            outbox_entry = BillingEventOutbox.objects.create(
                event_type="ChargePaid",
                exchange=BILLING_EVENTS_EXCHANGE,
                routing_key="billing.charge-paid.v1",
                payload=charge_paid_envelope
            )

            # Đồng thời tạo SettlementDecision cho Pharmacy/Diagnostic
            decision_envelope = {
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
                    "decision": "SUCCEEDED",
                    "fence": 1,
                    "transactionId": str(payment.transaction_id or payment.id),
                    "amountVnd": int(charge.amount_vnd),
                    "decidedAt": now.isoformat()
                }
            }

            BillingEventOutbox.objects.create(
                event_type="SettlementDecision",
                exchange=BILLING_EVENTS_EXCHANGE,
                routing_key="billing.settlement-decision.v1",
                payload=decision_envelope
            )

            logger.info(f"Saga đối soát hoàn tất: Payment {payment.id} -> SUCCEEDED, Charge {charge.id} -> PAID")

            if publish_charge_paid(charge, payment, fence=1):
                outbox_entry.published_at = timezone.now()
                outbox_entry.save(update_fields=["published_at"])
            publish_settlement_decision(charge, payment, decision="SUCCEEDED", fence=1)

def drain_failed_outbox(conn):
    """Quét và gửi lại các outbox chưa gửi được (drain retry)."""
    pending = BillingEventOutbox.objects.filter(published_at__isnull=True).order_by("created_at")[:20]
    if not pending:
        return
    channel = None
    try:
        channel = conn.channel()
        for entry in pending:
            channel.exchange_declare(exchange=entry.exchange, exchange_type="topic", durable=True)
            body = json.dumps(entry.payload, ensure_ascii=False).encode("utf-8")
            channel.basic_publish(
                exchange=entry.exchange,
                routing_key=entry.routing_key,
                body=body,
                properties=pika.BasicProperties(delivery_mode=2, content_type="application/json")
            )
            entry.published_at = timezone.now()
            entry.save(update_fields=["published_at"])
    except Exception as e:
        logger.warning(f"Lỗi khi drain billing outbox: {e}")

def start_consumer():
    """Khởi chạy consumer lắng nghe lệnh từ cả 3 nguồn (Appointment, Pharmacy, Diagnostic)."""
    while True:
        try:
            logger.info("Đang kết nối tới RabbitMQ...")
            conn = get_rabbitmq_connection()
            channel = conn.channel()

            channel.queue_declare(queue=BILLING_COMMAND_QUEUE, durable=True)

            # Lắng nghe lệnh từ cả 3 nguồn
            EXCHANGES_AND_KEYS = [
                (APPOINTMENT_COMMANDS_EXCHANGE, "billing.request-charge.v1"),
                (APPOINTMENT_COMMANDS_EXCHANGE, "billing.reserve-settlement.v1"),
                (BILLING_COMMANDS_EXCHANGE, "billing.request-charge.v1"),
                (BILLING_COMMANDS_EXCHANGE, "diagnostic.reserve-settlement.v1"),
                (BILLING_COMMANDS_EXCHANGE, "pharmacy.reserve-settlement.v1"),
                (BILLING_COMMANDS_EXCHANGE, "billing.reserve-settlement.v1"),
            ]

            for exchange_name, routing_key in EXCHANGES_AND_KEYS:
                channel.exchange_declare(exchange=exchange_name, exchange_type="topic", durable=True)
                channel.queue_bind(
                    exchange=exchange_name,
                    queue=BILLING_COMMAND_QUEUE,
                    routing_key=routing_key
                )

            def on_message_received(ch, method, properties, body):
                try:
                    raw_data = json.loads(body.decode("utf-8"))
                    logger.info(f"Nhận message [{method.routing_key}]: {raw_data}")

                    rk = method.routing_key
                    if "request-charge" in rk:
                        handle_request_charge(raw_data)
                    elif "reserve-settlement" in rk:
                        handle_reserve_settlement(raw_data)
                    else:
                        logger.warning(f"Bỏ qua routing key không hỗ trợ: {rk}")

                    ch.basic_ack(delivery_tag=method.delivery_tag)
                except Exception as e:
                    logger.error(f"Lỗi khi xử lý message [{method.routing_key}]: {e}")
                    ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue=BILLING_COMMAND_QUEUE, on_message_callback=on_message_received)
            logger.info(f"Billing Consumer sẵn sàng lắng nghe trên queue [{BILLING_COMMAND_QUEUE}]...")

            # Vòng lặp lắng nghe kết hợp xử lý đối soát và drain outbox định kỳ
            while conn.is_open:
                conn.process_data_events(time_limit=2)
                process_pending_settlements()
                drain_failed_outbox(conn)

        except Exception as exc:
            logger.warning(f"Mất kết nối RabbitMQ ({exc}). Thử lại sau 5 giây...")
            time.sleep(5)
