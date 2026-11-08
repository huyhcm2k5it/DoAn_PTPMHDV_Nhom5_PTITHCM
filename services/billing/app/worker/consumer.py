"""Durable Billing inbox/retry dispatch; only owner contracts are consumed."""
import json
import logging
import random
import time
from datetime import timedelta
from django.db import transaction, OperationalError
from django.core.exceptions import ObjectDoesNotExist
from django.utils import timezone
from app.domain.models import BillingRetryJob, BillingDeadLetter
from app.worker.event_bus import get_rabbitmq_connection, publish_charge_prepared, publish_charge_paid
from app.application.charge_service import handle_request_charge

logger=logging.getLogger(__name__)
BILLING_COMMAND_QUEUE="cmd.billing.v1"
EVENT_QUEUE="evt.billing.v1"
ROUTING_KEY_REQUEST_CHARGE="billing.request-charge.v1"


def dispatch(envelope):
    kind=envelope.get("messageType")
    if kind=="RequestCharge":
        return handle_request_charge(envelope)
    if kind=="SettlementReserved":
        from app.application.settlement_service import apply_settlement_reserved
        return apply_settlement_reserved(envelope)
    if kind=="QuerySettlement":
        from app.application.settlement_service import apply_query_settlement
        return apply_query_settlement(envelope)
    if kind=="PatientAccessChanged":
        from app.application.projection_service import apply_patient_access
        return apply_patient_access(envelope)
    if kind in ("AppointmentChanged","LabCancelled","MedicationHoldChanged"):
        from app.application.refund_service import apply_source_cancellation
        return apply_source_cancellation(envelope)
    raise ValueError("Unsupported Billing message")


@transaction.atomic
def record_failure(envelope, transient, attempt=0):
    from app.infrastructure.message_delivery import digest
    key=envelope.get("messageId") or digest(envelope)
    if transient and attempt < 3:
        BillingRetryJob.objects.update_or_create(message_id=key,defaults={
            "envelope":envelope,"attempts":attempt+1,
            "due_at":timezone.now()+timedelta(seconds=(5,15,60)[attempt]+random.uniform(0,1))})
    else:
        BillingDeadLetter.objects.get_or_create(message_id=key,defaults={
            "envelope":envelope,"reason":"RETRY_EXHAUSTED" if transient else "INVALID_MESSAGE"})
        BillingRetryJob.objects.filter(message_id=key).delete()


def process_pending_settlements():
    from app.application.settlement_service import mark_in_doubt, drain_outbox
    mark_in_doubt()
    drain_outbox()
    for job_id in BillingRetryJob.objects.filter(due_at__lte=timezone.now()).values_list("id",flat=True)[:50]:
        with transaction.atomic():
            job=BillingRetryJob.objects.select_for_update().filter(id=job_id).first()
            if not job:
                continue
            try:
                with transaction.atomic():
                    dispatch(job.envelope)
            except (OperationalError,ObjectDoesNotExist):
                record_failure(job.envelope,True,job.attempts)
            except (ValueError,KeyError,TypeError):
                record_failure(job.envelope,False,job.attempts)
            else:
                job.delete()


def start_consumer():
    delay=1
    while True:
        conn=None
        try:
            conn=get_rabbitmq_connection()
            channel=conn.channel()
            for queue in (BILLING_COMMAND_QUEUE,EVENT_QUEUE):
                channel.queue_declare(queue=queue,durable=True,arguments={"x-queue-type":"quorum"})
            bindings=[]
            for owner in ("appointment","diagnostic","pharmacy"):
                for key in ("billing.request-charge.v1","billing.query-settlement.v1"):
                    bindings.append(("umc.commands."+owner+".v1",key,BILLING_COMMAND_QUEUE))
                bindings.append(("umc.events."+owner+".v1",owner+".settlement-reserved.v1",EVENT_QUEUE))
            for owner,key in (("appointment","appointment.appointment-changed.v1"),
                              ("diagnostic","diagnostic.lab-cancelled.v1"),
                              ("pharmacy","pharmacy.medication-hold-changed.v1"),
                              ("patient","patient.patient-access-changed.v1")):
                bindings.append(("umc.events."+owner+".v1",key,EVENT_QUEUE))
            for exchange,key,queue in bindings:
                channel.exchange_declare(exchange=exchange,exchange_type="topic",durable=True)
                channel.queue_bind(exchange=exchange,queue=queue,routing_key=key)
            def received(ch,method,properties,body):
                try:
                    envelope=json.loads(body)
                    if not isinstance(envelope,dict):
                        raise ValueError()
                except (ValueError,UnicodeDecodeError):
                    import hashlib
                    envelope={"invalidBodyHash":hashlib.sha256(body).hexdigest()}
                try:
                    dispatch(envelope)
                except (OperationalError,ObjectDoesNotExist):
                    record_failure(envelope,True)
                except (ValueError,KeyError,TypeError):
                    record_failure(envelope,False)
                ch.basic_ack(delivery_tag=method.delivery_tag)
            channel.basic_qos(prefetch_count=10)
            for queue in (BILLING_COMMAND_QUEUE,EVENT_QUEUE):
                channel.basic_consume(queue=queue,on_message_callback=received)
            delay=1
            while conn.is_open:
                conn.process_data_events(time_limit=1)
                process_pending_settlements()
        except Exception:
            logger.warning("Billing dependency unavailable; durable state retained")
            time.sleep(delay+random.uniform(0,0.5))
            delay=min(delay*2,15)
        finally:
            if conn and conn.is_open:
                conn.close()
