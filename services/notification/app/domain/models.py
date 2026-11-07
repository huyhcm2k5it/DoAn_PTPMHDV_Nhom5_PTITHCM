import uuid
from django.db import models

class Notification(models.Model):
    """Bảng notifications: thông báo gửi cho một tài khoản.
    user_id là LREF sang Identity; Notification không đọc DB của Identity.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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
