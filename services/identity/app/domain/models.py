import uuid
from django.db import models
from django.contrib.auth.hashers import make_password, check_password
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from django.db.models.manager import RelatedManager

class User(models.Model):
    """Bảng users: Quản lý thông tin tài khoản cho cả 3 actor (PATIENT, DOCTOR, STAFF)."""
    if TYPE_CHECKING:
        capabilities: RelatedManager["StaffCapability"]
        
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=20, unique=True, help_text="Số điện thoại định danh")
    email = models.EmailField(max_length=255, null=True, blank=True, help_text="Email nhận thông báo/OTP")
    password_hash = models.CharField(max_length=255)
    actor_type = models.CharField(
        max_length=20,
        choices=[("PATIENT", "PATIENT"), ("DOCTOR", "DOCTOR"), ("STAFF", "STAFF")],
        default="PATIENT"
    )
    status = models.CharField(
        max_length=30,
        choices=[("PENDING_VERIFICATION", "PENDING_VERIFICATION"), ("ACTIVE", "ACTIVE"), ("BLOCKED", "BLOCKED")],
        default="PENDING_VERIFICATION"
    )
    phone_verified_at = models.DateTimeField(null=True, blank=True)
    version = models.IntegerField(default=1)
    token_version = models.IntegerField(default=1, help_text="Tăng khi đổi mật khẩu để thu hồi token cũ")
    access_version = models.IntegerField(default=1)
    failed_login_attempts = models.PositiveIntegerField(default=0, help_text="Số lần đăng nhập sai liên tiếp")
    locked_until = models.DateTimeField(null=True, blank=True, help_text="Khoá tạm đăng nhập tới thời điểm này")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "users"

    def set_password(self, raw_password):
        self.password_hash = make_password(raw_password)

    def check_password(self, raw_password):
        return check_password(raw_password, self.password_hash)

    def __str__(self):
        return f"{self.phone} [{self.actor_type}] ({self.status})"


class OtpRequest(models.Model):
    """Bảng otp_requests: Quản lý mã xác thực OTP 6 số, giới hạn thử và thời hạn."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True, related_name="otp_requests")
    phone = models.CharField(max_length=20)
    email = models.EmailField(max_length=255, null=True, blank=True, help_text="Email nhận OTP (nếu có)")
    purpose = models.CharField(max_length=20, choices=[("REGISTER", "REGISTER"), ("RESET", "RESET")])
    code_hash = models.CharField(max_length=255)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    attempts = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "otp_requests"
        indexes = [
            models.Index(fields=["phone", "purpose", "expires_at"]),
        ]

    def set_code(self, raw_code):
        self.code_hash = make_password(raw_code)

    def check_code(self, raw_code):
        return check_password(raw_code, self.code_hash)

    def __str__(self):
        return f"OTP {self.phone} [{self.purpose}] used={bool(self.used_at)}"


class Session(models.Model):
    """Bảng sessions: Lưu vết refresh token cho đăng nhập đa thiết bị."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sessions")
    refresh_hash = models.CharField(max_length=255, unique=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    device_id = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sessions"
        indexes = [
            models.Index(fields=["user", "expires_at"]),
        ]

    def __str__(self):
        return f"Session {self.id} for {self.user.phone}"


class StaffCapability(models.Model):
    """Bảng staff_capabilities: Phân quyền tác vụ cho nhân viên STAFF."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="capabilities")
    capability = models.CharField(max_length=50, help_text="RECEPTION, CASHIER, ADMIN...")
    scope_key = models.CharField(max_length=50, default="GLOBAL")
    enabled = models.BooleanField(default=True)
    assigned_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="granted_capabilities")
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "staff_capabilities"
        constraints = [
            models.UniqueConstraint(fields=["user", "capability", "scope_key"], name="uq_staff_capability_scope")
        ]

    def __str__(self):
        return f"{self.user.phone} -> {self.capability} ({self.scope_key})"


class AuditEvent(models.Model):
    """Bảng audit_events: Bảng bất biến (append-only) ghi vết an ninh."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor_user_id = models.UUIDField(null=True, blank=True)
    action = models.CharField(max_length=100)
    target_id = models.UUIDField(null=True, blank=True)
    before_after = models.JSONField(null=True, blank=True)
    correlation_id = models.UUIDField()
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "audit_events"
        indexes = [
            models.Index(fields=["actor_user_id", "at"]),
        ]

    def __str__(self):
        return f"Audit {self.action} by {self.actor_user_id} at {self.at}"


class DevSmsInbox(models.Model):
    """Hộp thư SMS giả lập cho demo local.

    Chỉ dùng khi SMS_BACKEND=dev_inbox. Bảng này thay cho màn hình điện thoại:
    endpoint dev đọc mã ở đây để người dùng nhập lại đúng mã đã gửi.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=20)
    purpose = models.CharField(max_length=20)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "dev_sms_inbox"
        indexes = [
            models.Index(fields=["phone", "created_at"], name="idx_dev_sms_phone_created"),
        ]

    def __str__(self):
        return f"SMS {self.phone} [{self.purpose}] at {self.created_at}"

class IdempotencyRecord(models.Model):
    """Bảng idempotency_records: giữ request hash theo Idempotency-Key.

    02_ThamSo yêu cầu "cùng key với payload khác phải trả 409", nên ngoài việc
    replay kết quả cũ còn phải phát hiện payload đã đổi so với lần ghi đầu.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scope = models.CharField(max_length=40, help_text="API ID sở hữu khóa, ví dụ IA-012")
    key = models.CharField(max_length=100)
    request_hash = models.CharField(max_length=64)
    response = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "idempotency_records"
        constraints = [
            models.UniqueConstraint(fields=["scope", "key"], name="uq_identity_idem_scope_key"),
        ]
        indexes = [
            models.Index(fields=["created_at"], name="idx_identity_idem_created"),
        ]

    def __str__(self):
        return f"Idempotency {self.scope}/{self.key}"


class IdentityEventOutbox(models.Model):
    """Bảng outbox cho Identity: phát sự kiện IdentityAccessChanged."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=50, default="IdentityAccessChanged")
    exchange = models.CharField(max_length=100, default="umc.events.identity.v1")
    routing_key = models.CharField(max_length=100, default="identity.identity-access-changed.v1")
    payload = models.JSONField(default=dict)
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "identity_event_outbox"
        indexes = [
            models.Index(fields=["published_at", "created_at"], name="idx_id_outbox_pub_created"),
        ]

    def __str__(self):
        return f"IdentityEventOutbox {self.event_type} [{self.id}] pub={bool(self.published_at)}"


class IdentityOutbox(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    aggregate_id = models.UUIDField()
    version = models.PositiveBigIntegerField()
    envelope = models.JSONField()
    published_at = models.DateTimeField(null=True)
    attempts = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["aggregate_id", "version"], name="uq_identity_access_version")]
