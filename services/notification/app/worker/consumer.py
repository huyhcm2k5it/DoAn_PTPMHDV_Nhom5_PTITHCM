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
from app.application.messages import digest, receive
from app.application.presentation import MESSAGES
from app.domain.models import (
    DeadLetter, LegacyNotification, Notification, NotificationDeliveryKey, RetryJob,
)
from app.worker.event_bus import get_rabbitmq_connection, NOTIFICATION_QUEUE, BINDINGS

logger = logging.getLogger(__name__)
ROUTES = {
    "appointment.appointment-changed.v1": ("AppointmentChanged", "appointment", "APPOINTMENT"),
    "billing.billing-status-changed.v1": ("BillingStatusChanged", "billing", "BILLING"),
    "diagnostic.lab-result-published.v1": ("LabResultPublished", "diagnostic", "DIAGNOSTIC"),
    "pharmacy.medication-dispensed.v1": ("MedicationDispensed", "pharmacy", "PHARMACY"),
}
REQUIRED = {"messageId", "messageKind", "messageType", "schemaVersion", "producer",
            "aggregateId", "aggregateVersion", "correlationId", "causationId",
            "requestId", "occurredAt", "payload"}


@transaction.atomic
def route_event(routing_key, envelope):
    if routing_key == "identity.identity-access-changed.v1":
        from app.application.identity_projection import apply_identity_access
        return apply_identity_access(envelope)
    route = ROUTES.get(routing_key)
    if not route or not isinstance(envelope,dict) or set(envelope) != REQUIRED:
        raise ValueError("Unknown notification routing key or invalid envelope")
    kind, producer, notification_kind = route
    if (envelope["messageKind"] != "EVENT" or envelope["messageType"] != kind
            or envelope["producer"] != producer or type(envelope["schemaVersion"]) is not int
            or envelope["schemaVersion"] != 1):
        raise ValueError("Untrusted notification event")
    uuid.UUID(str(envelope["messageId"]))
    uuid.UUID(str(envelope["aggregateId"]))
    if type(envelope["aggregateVersion"]) is not int or envelope["aggregateVersion"] < 1:
        raise ValueError("Invalid aggregate version")
    payload = envelope["payload"]
    if not isinstance(payload,dict):
        raise ValueError("Object payload required")
    recipient = uuid.UUID(str(payload["recipientUserId"]))
    subject_field, _ = MESSAGES[kind]
    subject_ref = str(uuid.UUID(str(payload[subject_field])))
    inbox = receive(envelope, "notification")
    if inbox is None:
        return "REPLAYED"
    key = digest([producer,kind,envelope["aggregateId"],envelope["aggregateVersion"],str(recipient)])
    if LegacyNotification.objects.filter(dedupe_key=key).exists():
        return "APPLIED"
    _, created = NotificationDeliveryKey.objects.get_or_create(pk=key)
    if created:
        notification = Notification.objects.create(
            event_id=inbox.message_id, recipient_user_id=recipient, kind=notification_kind,
            subject_ref=subject_ref, message_code=kind,
        )
        inbox.outcome_ref = str(notification.id)
        inbox.save(update_fields=["outcome_ref"])
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
