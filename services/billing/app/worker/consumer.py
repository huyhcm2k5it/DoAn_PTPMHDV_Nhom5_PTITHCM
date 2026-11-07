import json
import logging
import time
import pika
from django.db import transaction
from django.utils import timezone
from app.domain.models import Charge, Payment, Receipt, SettlementSaga, BillingEventOutbox
from app.worker.event_bus import (
    get_rabbitmq_connection,
    publish_charge_prepared,
    publish_charge_paid,
    BILLING_EVENTS_EXCHANGE,
    APPOINTMENT_COMMANDS_EXCHANGE
)

logger = logging.getLogger(__name__)

BILLING_COMMAND_QUEUE = "cmd.billing.v1"
ROUTING_KEY_REQUEST_CHARGE = "billing.request-charge.v1"

def handle_request_charge(payload: dict):
    """Xử lý command RequestCharge: tạo khoản thu Charge và lưu outbox/bắn ChargePrepared"""
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
            "requestId": str(request_id),
            "sourceType": source_type,
            "sourceId": str(source_id),
            "sourceRevision": source_revision,
            "chargeId": str(charge.id),
            "state": "CREATED" if created else "REUSED",
            "reasonCode": None,
            "emittedAt": timezone.now().isoformat()
        }

        outbox = BillingEventOutbox.objects.create(
            event_type="ChargePrepared",
            exchange=BILLING_EVENTS_EXCHANGE,
            routing_key="billing.charge-prepared.v1",
            payload=prepared_payload
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
        state="CREATED" if created else "REUSED"
    ):
        outbox.published_at = timezone.now()
        outbox.save(update_fields=["published_at"])

def process_pending_settlements():
    """Tự động xử lý đối soát cho các khoản thanh toán đang PENDING.

    Áp dụng cho cả SIMULATION (bệnh nhân tự trả) và COUNTER (thu tại quầy):
    cả hai đều phải chốt PAID và phát hành biên nhận qua cùng một luồng.
    """
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

            now = timezone.now()
            payment.state = "SUCCEEDED"
            payment.paid_at = now
            payment.save(update_fields=["state", "paid_at"])

            charge = payment.charge
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

            outbox_payload = {
                "chargeId": str(charge.id),
                "sourceType": charge.source_type,
                "sourceId": str(charge.source_id),
                "sourceRevision": charge.source_revision,
                "settlementId": str(payment.id),
                "fence": "PAID",
                "transactionId": str(payment.transaction_id),
                "amountVnd": charge.amount_vnd,
                "paidAt": now.isoformat()
            }

            outbox_entry = BillingEventOutbox.objects.create(
                event_type="ChargePaid",
                exchange=BILLING_EVENTS_EXCHANGE,
                routing_key="billing.charge-paid.v1",
                payload=outbox_payload
            )

            logger.info(f"Saga đối soát hoàn tất: Payment {payment.id} -> SUCCEEDED, Charge {charge.id} -> PAID, Outbox {outbox_entry.id}")

            if publish_charge_paid(charge, payment):
                outbox_entry.published_at = timezone.now()
                outbox_entry.save(update_fields=["published_at"])

def start_consumer():
    """Khởi chạy consumer lắng nghe lệnh từ broker và kiểm tra định kỳ đối soát."""
    while True:
        try:
            logger.info("Đang kết nối tới RabbitMQ...")
            conn = get_rabbitmq_connection()
            channel = conn.channel()

            # Đảm bảo exchange, queue và binding tồn tại
            channel.exchange_declare(exchange=APPOINTMENT_COMMANDS_EXCHANGE, exchange_type="topic", durable=True)
            channel.queue_declare(queue=BILLING_COMMAND_QUEUE, durable=True)
            channel.queue_bind(
                exchange=APPOINTMENT_COMMANDS_EXCHANGE,
                queue=BILLING_COMMAND_QUEUE,
                routing_key=ROUTING_KEY_REQUEST_CHARGE
            )

            def on_message_received(ch, method, properties, body):
                try:
                    payload = json.loads(body.decode("utf-8"))
                    logger.info(f"Nhận message [{method.routing_key}]: {payload}")
                    if method.routing_key == ROUTING_KEY_REQUEST_CHARGE:
                        handle_request_charge(payload)
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                except Exception as e:
                    logger.error(f"Lỗi khi xử lý message: {e}")
                    ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue=BILLING_COMMAND_QUEUE, on_message_callback=on_message_received)
            logger.info(f"Billing Consumer sẵn sàng lắng nghe trên queue [{BILLING_COMMAND_QUEUE}]...")

            # Vòng lặp lắng nghe kết hợp xử lý đối soát định kỳ
            while conn.is_open:
                conn.process_data_events(time_limit=2)
                process_pending_settlements()

        except Exception as exc:
            logger.warning(f"Mất kết nối RabbitMQ ({exc}). Thử lại sau 5 giây...")
            time.sleep(5)
