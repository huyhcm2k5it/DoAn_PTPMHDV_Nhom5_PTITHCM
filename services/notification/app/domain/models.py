import uuid
from django.db import models

class Notification(models.Model):
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
        db_table = "notifications"
        indexes = [
            models.Index(fields=["user_id", "created_at"], name="idx_notif_user_created"),
            models.Index(fields=["user_id", "read_at"], name="idx_notif_user_unread"),
        ]

    def __str__(self):
        return f"Notification {self.id} for {self.user_id} ({self.kind})"

class MessageInbox(models.Model):
    message_id = models.UUIDField(primary_key=True)
    body_hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)


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
