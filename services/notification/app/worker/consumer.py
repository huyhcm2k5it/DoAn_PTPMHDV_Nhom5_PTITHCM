"""Durable, idempotent notification delivery. Medical values never enter DTO payloads."""
import hashlib
import json
import logging
import random
import time
import uuid
from datetime import timedelta
from django.db import connections, transaction, OperationalError
from django.utils import timezone
from app.domain.models import Notification, MessageInbox, RetryJob, DeadLetter
from app.worker.event_bus import get_rabbitmq_connection, NOTIFICATION_QUEUE, BINDINGS

logger = logging.getLogger(__name__)
ROUTES = {
    "appointment.appointment-changed.v1": ("AppointmentChanged", "appointment", "APPOINTMENT", "Lịch khám có cập nhật"),
    "billing.billing-status-changed.v1": ("BillingStatusChanged", "billing", "BILLING", "Viện phí có cập nhật"),
    "diagnostic.lab-result-published.v1": ("LabResultPublished", "diagnostic", "DIAGNOSTIC", "Có kết quả xét nghiệm mới"),
    "pharmacy.medication-dispensed.v1": ("MedicationDispensed", "pharmacy", "PHARMACY", "Đã cấp phát đơn thuốc"),
}
SAFE_FIELDS = ("appointmentId", "chargeId", "paymentId", "refundId", "orderId", "holdId",
               "prescriptionId", "revision", "attemptNo", "state", "changeType", "version",
               "dispensedAt", "publishedAt")
REQUIRED = {"messageId", "messageKind", "messageType", "schemaVersion", "producer",
            "aggregateId", "aggregateVersion", "correlationId", "causationId",
            "requestId", "occurredAt", "payload"}


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(",",":")).encode()).hexdigest()


@transaction.atomic
def route_event(routing_key, envelope):
    route = ROUTES.get(routing_key)
    if not route or not isinstance(envelope,dict) or set(envelope) != REQUIRED:
        raise ValueError("Unknown notification routing key or invalid envelope")
    kind, producer, notification_kind, title = route
    if (envelope["messageKind"] != "EVENT" or envelope["messageType"] != kind
            or envelope["producer"] != producer or type(envelope["schemaVersion"]) is not int
            or envelope["schemaVersion"] != 1):
        raise ValueError("Untrusted notification event")
    uuid.UUID(str(envelope["messageId"]))
    uuid.UUID(str(envelope["aggregateId"]))
    if type(envelope["aggregateVersion"]) is not int or envelope["aggregateVersion"] < 1:
        raise ValueError("Invalid aggregate version")
    body_hash = digest(envelope)
    prior = MessageInbox.objects.filter(message_id=envelope["messageId"]).first()
    if prior:
        if prior.body_hash != body_hash:
            raise ValueError("Duplicate message content conflict")
        return "REPLAYED"
    payload = envelope["payload"]
    if not isinstance(payload,dict):
        raise ValueError("Object payload required")
    recipient = uuid.UUID(str(payload["recipientUserId"]))
    key = digest([producer,kind,envelope["aggregateId"],envelope["aggregateVersion"],str(recipient)])
    Notification.objects.get_or_create(dedupe_key=key, defaults={
        "user_id":recipient, "kind":notification_kind, "title":title,
        "body":"Mở ứng dụng để xem trạng thái đã được hệ thống xác nhận.",
        "payload":{k:payload[k] for k in SAFE_FIELDS if k in payload},
    })
    MessageInbox.objects.create(message_id=envelope["messageId"], body_hash=body_hash)
    return "APPLIED"


@transaction.atomic
def record_failure(routing_key, envelope, transient, attempt=0):
    message_id = str(envelope.get("messageId","")) if isinstance(envelope,dict) else ""
    # Raw bodies live only in the protected error store, never ordinary logs.
    if transient and attempt < 3:
        job, _ = RetryJob.objects.get_or_create(message_id=message_id or digest(envelope),
            defaults={"routing_key":routing_key,"envelope":envelope,
                      "attempts":attempt+1,"due_at":timezone.now()+timedelta(seconds=(5,15,60)[attempt]+random.uniform(0,1))})
        if job.attempts <= attempt:
            job.attempts = attempt+1
            job.due_at = timezone.now()+timedelta(seconds=(5,15,60)[attempt]+random.uniform(0,1))
            job.save(update_fields=["attempts","due_at"])
        return
    DeadLetter.objects.get_or_create(message_id=message_id or digest(envelope),
        defaults={"routing_key":routing_key,"envelope":envelope,"reason":"RETRY_EXHAUSTED" if transient else "INVALID_MESSAGE"})
    RetryJob.objects.filter(message_id=message_id).delete()


def process_due_retries():
    for job_id in RetryJob.objects.filter(due_at__lte=timezone.now()).values_list("id",flat=True)[:50]:
        with transaction.atomic():
            job = RetryJob.objects.select_for_update().filter(id=job_id).first()
            if not job:
                continue
            try:
                with transaction.atomic():
                    route_event(job.routing_key,job.envelope)
            except OperationalError:
                record_failure(job.routing_key,job.envelope,True,job.attempts)
            except (ValueError,KeyError,TypeError):
                record_failure(job.routing_key,job.envelope,False,job.attempts)
            else:
                job.delete()


def start_consumer():
    delay = 1
    while True:
        conn = None
        try:
            conn = get_rabbitmq_connection()
            channel = conn.channel()
            channel.queue_declare(queue=NOTIFICATION_QUEUE,durable=True,arguments={"x-queue-type":"quorum"})
            for exchange,key in BINDINGS:
                channel.exchange_declare(exchange=exchange,exchange_type="topic",durable=True)
                channel.queue_bind(exchange=exchange,queue=NOTIFICATION_QUEUE,routing_key=key)
            def received(ch,method,properties,body):
                try:
                    envelope = json.loads(body)
                except (ValueError,UnicodeDecodeError):
                    envelope = {"messageId":str(uuid.uuid4()),"invalidUtf8BodyHash":hashlib.sha256(body).hexdigest()}
                try:
                    route_event(method.routing_key,envelope)
                except OperationalError:
                    record_failure(method.routing_key,envelope,True)
                except (ValueError,KeyError,TypeError):
                    record_failure(method.routing_key,envelope,False)
                # A failed persistence operation escapes without ack; reconnect redelivers.
                ch.basic_ack(delivery_tag=method.delivery_tag)
            channel.basic_qos(prefetch_count=10)
            channel.basic_consume(queue=NOTIFICATION_QUEUE,on_message_callback=received)
            delay=1
            while conn.is_open:
                conn.process_data_events(time_limit=1)
                process_due_retries()
        except Exception:
            logger.warning("Notification dependency unavailable; reconnect scheduled")
            time.sleep(delay+random.uniform(0,0.5))
            delay=min(delay*2,15)
        finally:
            try:
                if conn and conn.is_open:
                    conn.close()
            finally:
                # Workers have no request lifecycle to discard broken DB sessions.
                connections.close_all()
