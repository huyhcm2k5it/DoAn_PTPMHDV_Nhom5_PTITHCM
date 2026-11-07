import json
import logging
import time
from django.db import transaction
from app.domain.models import Notification
from app.worker.event_bus import (
    get_rabbitmq_connection,
    NOTIFICATION_QUEUE,
    BINDINGS,
)

logger = logging.getLogger(__name__)

def handle_appointment_changed(payload: dict):
    """Sự kiện appointment.appointment-changed.v1: Đặt, đổi, hủy lịch khám."""
    recipient_user_id = payload.get("recipientUserId")
    if not recipient_user_id:
        return

    change_type = payload.get("changeType", "UPDATED")
    if change_type == "BOOKED":
        title = "Đặt lịch khám thành công"
        body = "Lịch hẹn khám bệnh của bạn đã được xác nhận. Vui lòng có mặt đúng giờ."
    elif change_type == "CANCELLED":
        title = "Lịch khám đã được hủy"
        body = "Lịch hẹn khám bệnh của bạn đã được hủy thành công."
    elif change_type == "RESCHEDULED":
        title = "Lịch khám đã được dời giờ"
        body = "Thời gian khám bệnh của bạn đã được cập nhật sang khung giờ mới."
    else:
        title = "Trạng thái lịch khám thay đổi"
        body = f"Lịch khám của bạn có cập nhật mới ({change_type})."

    Notification.objects.create(
        user_id=recipient_user_id,
        kind="APPOINTMENT",
        title=title,
        body=body,
        payload=payload
    )
    logger.info(f"Đã tạo thông báo APPOINTMENT cho user {recipient_user_id}")

def handle_billing_status_changed(payload: dict):
    """Sự kiện billing.billing-status-changed.v1: Thu tiền hoặc hoàn tiền."""
    recipient_user_id = payload.get("recipientUserId")
    if not recipient_user_id:
        return

    state = payload.get("state", "")
    if state == "PAID":
        title = "Thanh toán viện phí thành công"
        body = "Khoản viện phí của bạn đã được thanh toán thành công và ghi nhận biên nhận điện tử."
    elif state == "REFUNDED":
        title = "Hoàn tiền viện phí hoàn tất"
        body = "Yêu cầu hoàn tiền viện phí của bạn đã được xử lý thành công."
    elif state == "EXPIRED":
        title = "Khoản thu viện phí đã hết hạn"
        body = "Phiên thanh toán viện phí của bạn đã hết hạn xử lý."
    else:
        title = "Cập nhật viện phí"
        body = f"Khoản viện phí của bạn đã chuyển sang trạng thái {state}."

    Notification.objects.create(
        user_id=recipient_user_id,
        kind="BILLING",
        title=title,
        body=body,
        payload=payload
    )
    logger.info(f"Đã tạo thông báo BILLING cho user {recipient_user_id}")

def handle_lab_result_published(payload: dict):
    """Sự kiện diagnostic.lab-result-published.v1: Kết quả XN được công bố.
    Quy tắc an toàn: Không mang giá trị chỉ số y tế vào Notification.
    """
    recipient_user_id = payload.get("recipientUserId")
    if not recipient_user_id:
        return

    Notification.objects.create(
        user_id=recipient_user_id,
        kind="DIAGNOSTIC",
        title="Có kết quả xét nghiệm mới",
        body="Kết quả xét nghiệm cận lâm sàng của bạn đã được bác sĩ trưởng khoa phê duyệt và công bố.",
        payload=payload
    )
    logger.info(f"Đã tạo thông báo DIAGNOSTIC cho user {recipient_user_id}")

def handle_medication_dispensed(payload: dict):
    """Sự kiện pharmacy.medication-dispensed.v1: Thuốc đã cấp phát.
    Quy tắc an toàn: Không để lộ tên thuốc trong nội dung thông báo.
    """
    recipient_user_id = payload.get("recipientUserId")
    if not recipient_user_id:
        return

    Notification.objects.create(
        user_id=recipient_user_id,
        kind="PHARMACY",
        title="Đã cấp phát đơn thuốc",
        body="Toa thuốc của bạn đã được dược sĩ kiểm tra và cấp phát tại quầy thuốc bệnh viện.",
        payload=payload
    )
    logger.info(f"Đã tạo thông báo PHARMACY cho user {recipient_user_id}")

def route_event(routing_key: str, payload: dict):
    """Định tuyến sự kiện về đúng hàm nghiệp vụ."""
    with transaction.atomic():
        if routing_key == "appointment.appointment-changed.v1":
            handle_appointment_changed(payload)
        elif routing_key == "billing.billing-status-changed.v1":
            handle_billing_status_changed(payload)
        elif routing_key == "diagnostic.lab-result-published.v1":
            handle_lab_result_published(payload)
        elif routing_key == "pharmacy.medication-dispensed.v1":
            handle_medication_dispensed(payload)
        else:
            logger.warning(f"Bỏ qua routing key không nằm trong danh sách xử lý: {routing_key}")

from django.db import DatabaseError, OperationalError

def start_consumer():
    """Vòng lặp lắng nghe message trên hàng đợi RabbitMQ với exponential backoff."""
    retry_delay = 2
    max_delay = 30
    while True:
        conn = None
        try:
            logger.info("Notification Consumer đang kết nối RabbitMQ...")
            conn = get_rabbitmq_connection()
            channel = conn.channel()

            # Khai báo queue chung bền vững
            channel.queue_declare(queue=NOTIFICATION_QUEUE, durable=True)

            # Binding các exchange với queue
            for exchange, routing_key in BINDINGS:
                channel.exchange_declare(exchange=exchange, exchange_type="topic", durable=True)
                channel.queue_bind(exchange=exchange, queue=NOTIFICATION_QUEUE, routing_key=routing_key)

            def on_message(ch, method, properties, body):
                try:
                    payload = json.loads(body.decode("utf-8"))
                    logger.info(f"Nhận event [{method.routing_key}]: {payload}")
                    route_event(method.routing_key, payload)
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                except (DatabaseError, OperationalError) as db_err:
                    logger.error(f"Lỗi database tạm thời ({db_err}), requeue lại message...")
                    ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
                except Exception as err:
                    logger.error(f"Lỗi không thể phục hồi khi xử lý event notification: {err}")
                    ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

            channel.basic_qos(prefetch_count=10)
            channel.basic_consume(queue=NOTIFICATION_QUEUE, on_message_callback=on_message)
            logger.info(f"Notification Consumer đang chờ sự kiện trên [{NOTIFICATION_QUEUE}]...")
            retry_delay = 2  # Reset delay khi đã kết nối và lắng nghe thành công
            channel.start_consuming()

        except Exception as exc:
            logger.warning(f"Mất kết nối RabbitMQ ({exc}). Thử lại sau {retry_delay} giây...")
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, max_delay)
        finally:
            if conn and conn.is_open:
                try:
                    conn.close()
                except Exception:
                    pass