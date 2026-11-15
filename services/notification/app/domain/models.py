import uuid
from django.db import models

class LegacyNotification(models.Model):
    """Bảng notifications: thông báo gửi cho một tài khoản.
    user_id là LREF sang Identity; Notification không đọc DB của Identity.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dedupe_key = models.CharField(max_length=64, unique=True, null=True)
    user_id = models.UUIDField(help_text="LREF sang Identity users.id")
    kind = models.CharField(max_length=40, default="SYSTEM")
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    payload = models.JSONField(default=dict, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "legacy_notifications"
        indexes = [
            models.Index(fields=["user_id", "created_at"], name="idx_notif_user_created"),
            models.Index(fields=["user_id", "read_at"], name="idx_notif_user_unread"),
        ]

    def __str__(self):
        return f"Notification {self.id} for {self.user_id} ({self.kind})"

class LegacyMessageInbox(models.Model):
    message_id = models.UUIDField(primary_key=True)
    body_hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "legacy_notification_inbox"


class ReceivedMessage(models.Model):
    message_id = models.UUIDField(primary_key=True)
    command_id = models.UUIDField(null=True)
    payload_hash = models.CharField(max_length=64)
    source_aggregate_id = models.UUIDField()
    source_version = models.PositiveBigIntegerField()

    class Meta:
        db_table = "received_messages"


class MessageInbox(models.Model):
    message = models.ForeignKey(ReceivedMessage, on_delete=models.PROTECT)
    consumer_name = models.CharField(max_length=48)
    state = models.CharField(max_length=20, default="PROCESSED")
    outcome_ref = models.CharField(max_length=80, null=True)
    processed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "inbox"
        constraints = [
            models.UniqueConstraint(
                fields=["message", "consumer_name"], name="uq_notif_consumer_message",
            ),
        ]


class Notification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient_user_id = models.UUIDField()
    event = models.OneToOneField(ReceivedMessage, on_delete=models.PROTECT)
    kind = models.CharField(max_length=40)
    subject_ref = models.CharField(max_length=80)
    message_code = models.CharField(max_length=48)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "notifications"
        indexes = [
            models.Index(fields=["recipient_user_id", "-created_at"], name="idx_notif_recipient_created"),
        ]


class NotificationDeliveryKey(models.Model):
    """Retain producer/version deduplication even when the message ID changes."""

    key = models.CharField(max_length=64, primary_key=True)

    class Meta:
        db_table = "notification_delivery_keys"


class RetryJob(models.Model):
    message_id = models.CharField(max_length=64, unique=True)
    routing_key = models.CharField(max_length=200)
    envelope = models.JSONField()
    attempts = models.PositiveSmallIntegerField(default=1)
    due_at = models.DateTimeField(db_index=True)


class DeadLetter(models.Model):
    message_id = models.CharField(max_length=64, unique=True)
    routing_key = models.CharField(max_length=200)
    envelope = models.JSONField()
    reason = models.CharField(max_length=80)
    published_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)


class IdentityAccessProjection(models.Model):
    """Minimal owner-published access state; no Identity database reads."""
    user_id = models.UUIDField(primary_key=True)
    version = models.PositiveBigIntegerField(default=0)
    token_version = models.PositiveBigIntegerField(default=1)
    status = models.CharField(max_length=16, default="BLOCKED")
    actor_type = models.CharField(max_length=16, default="PATIENT")
    capabilities = models.JSONField(default=list)
    phone_verified = models.BooleanField(default=False)
    body_hash = models.CharField(max_length=64, default="")
    updated_at = models.DateTimeField(auto_now=True)
