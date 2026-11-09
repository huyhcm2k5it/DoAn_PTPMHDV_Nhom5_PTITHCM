import os
import json
import logging
import pika

logger = logging.getLogger(__name__)

RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "rabbitmq")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT", "5672"))
RABBITMQ_VHOST = os.getenv("RABBITMQ_VHOST", "/umc-care")

# Các Exchange sự kiện theo hợp đồng UMC Care
NOTIFICATION_QUEUE = "evt.notification.v1"
APPOINTMENT_EVENTS_EXCHANGE = "umc.events.appointment.v1"
BILLING_EVENTS_EXCHANGE = "umc.events.billing.v1"
DIAGNOSTIC_EVENTS_EXCHANGE = "umc.events.diagnostic.v1"
PHARMACY_EVENTS_EXCHANGE = "umc.events.pharmacy.v1"

# Danh sách routing key mà Notification quan tâm
BINDINGS = [
    (APPOINTMENT_EVENTS_EXCHANGE, "appointment.appointment-changed.v1"),
    (BILLING_EVENTS_EXCHANGE, "billing.billing-status-changed.v1"),
    (DIAGNOSTIC_EVENTS_EXCHANGE, "diagnostic.lab-result-published.v1"),
    (PHARMACY_EVENTS_EXCHANGE, "pharmacy.medication-dispensed.v1"),
]

def get_rabbitmq_connection():
    """Khởi tạo kết nối RabbitMQ từ biến môi trường."""
    url = os.getenv("UMC_AMQP_URL")
    if url:
        parameters = pika.URLParameters(url)
        parameters.socket_timeout = 5.0
        parameters.connection_attempts = 1
        parameters.heartbeat = 60
        parameters.blocked_connection_timeout = 300
        return pika.BlockingConnection(parameters)
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
        socket_timeout=5.0,
        connection_attempts=1,
        heartbeat=60,
        blocked_connection_timeout=300
    )
    return pika.BlockingConnection(parameters)
