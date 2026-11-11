"""Drain Identity's durable outbox with mandatory routing and publisher confirms."""
import json
import os
import random
import time
import pika
from django.core.management.base import BaseCommand
from django.db import connections
from django.utils import timezone
from app.domain.models import IdentityOutbox


class Command(BaseCommand):
    help = "Publish minimal Identity access changes; never include passwords or OTPs."

    def handle(self,*args,**options):
        delay=1
        while True:
            conn=None
            try:
                params=pika.URLParameters(os.environ["UMC_AMQP_URL"]) if os.environ.get("UMC_AMQP_URL") else pika.ConnectionParameters(
                    host=os.environ.get("RABBITMQ_HOST","rabbitmq"),
                    port=int(os.environ.get("RABBITMQ_PORT","5672")),
                    virtual_host=os.environ.get("RABBITMQ_VHOST","/umc-care"),
                    credentials=pika.PlainCredentials(os.environ["RABBITMQ_USER"],os.environ["RABBITMQ_PASSWORD"]),
                    heartbeat=60,socket_timeout=3,blocked_connection_timeout=3,connection_attempts=1)
                params.heartbeat=60
                params.socket_timeout=3
                params.blocked_connection_timeout=3
                params.connection_attempts=1
                conn=pika.BlockingConnection(params)
                channel=conn.channel()
                channel.exchange_declare(exchange="umc.events.identity.v1",exchange_type="topic",durable=True)
                channel.confirm_delivery()
                delay=1
                while conn.is_open:
                    for event in IdentityOutbox.objects.filter(published_at__isnull=True).order_by("created_at")[:50]:
                        channel.basic_publish(exchange="umc.events.identity.v1",
                            routing_key="identity.identity-access-changed.v1",
                            body=json.dumps(event.envelope),
                            properties=pika.BasicProperties(delivery_mode=2,message_id=event.envelope["messageId"]),
                            mandatory=True)
                        event.published_at=timezone.now()
                        event.attempts+=1
                        event.save(update_fields=["published_at","attempts"])
                    conn.process_data_events(time_limit=1)
            except Exception:
                self.stderr.write("Identity outbox unavailable; durable rows retained.")
                time.sleep(delay+random.uniform(0,0.5))
                delay=min(delay*2,15)
            finally:
                try:
                    if conn and conn.is_open:
                        conn.close()
                finally:
                    # Workers have no request lifecycle to discard broken DB sessions.
                    connections.close_all()
