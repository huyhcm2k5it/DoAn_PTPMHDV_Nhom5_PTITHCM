import uuid
from django.db import models
from django.contrib.auth.hashers import make_password, check_password

class User(models.Model):
    """Bảng users: Quản lý thông tin tài khoản cho cả 3 actor (PATIENT, DOCTOR, STAFF)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=20, unique=True, help_text="Số điện thoại định danh")
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
    device_id = models.CharField(max_length=100, null=True, blank=True)
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