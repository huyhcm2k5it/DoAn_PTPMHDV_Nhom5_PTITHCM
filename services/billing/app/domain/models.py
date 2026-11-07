import uuid
from django.db import models

class Charge(models.Model):
    """Bảng charges: Quản lý khoản phải thu (khám, xét nghiệm, đơn thuốc)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_id = models.UUIDField(help_text="LREF sang Patient Service")
    source_type = models.CharField(max_length=50, help_text="APPOINTMENT, DIAGNOSTIC, PHARMACY")
    source_id = models.UUIDField(help_text="LREF sang ID của nguồn (ví dụ: appointmentId)")
    source_revision = models.IntegerField(default=1)
    amount_vnd = models.BigIntegerField(help_text="Số tiền phải thu (VNĐ), >= 0")
    state = models.CharField(max_length=20, default="OPEN", help_text="OPEN, PAID, VOID")
    price_snapshot = models.JSONField(default=dict, blank=True)
    snapshot_hash = models.CharField(max_length=64, blank=True)
    settlement_id = models.UUIDField(null=True, blank=True)
    settlement_state = models.CharField(max_length=20, default="NONE")
    settlement_saga_id = models.UUIDField(null=True, blank=True)
    version = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "charges"
        indexes = [
            models.Index(fields=["patient_id", "created_at"], name="idx_charges_patient_created"),
            models.Index(fields=["state", "created_at"], name="idx_charges_state_created"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["source_type", "source_id", "source_revision"],
                name="uq_charges_source_rev"
            ),
            models.CheckConstraint(
                condition=models.Q(amount_vnd__gte=0),
                name="chk_charges_amount_positive"
            )
        ]

    def __str__(self):
        return f"Charge {self.id} [{self.source_type}:{self.source_id}] - {self.amount_vnd}đ ({self.state})"


class SettlementSaga(models.Model):
    """Bảng settlement_sagas: Điều phối giao dịch phân tán 2 pha với Appointment/Diag/Pharm."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    charge = models.ForeignKey(Charge, on_delete=models.CASCADE, related_name="sagas")
    source_type = models.CharField(max_length=50)
    source_id = models.UUIDField()
    source_revision = models.IntegerField(default=1)
    state = models.CharField(max_length=20, default="REQUESTED", help_text="REQUESTED, RESERVED, IN_DOUBT, SUCCEEDED, FAILED")
    fence = models.IntegerField(null=True, blank=True)
    amount_hash = models.CharField(max_length=64, blank=True)
    decision_version = models.IntegerField(default=1)
    deadline_at = models.DateTimeField(null=True, blank=True)
    version = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "settlement_sagas"

    def __str__(self):
        return f"Saga {self.id} for Charge {self.charge.id} ({self.state})"


class Payment(models.Model):
    """Bảng payments: Ghi nhận giao dịch thanh toán (mô phỏng hoặc tại quầy)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    charge = models.ForeignKey(Charge, on_delete=models.CASCADE, related_name="payments")
    saga = models.ForeignKey(SettlementSaga, on_delete=models.SET_NULL, null=True, blank=True, related_name="payments")
    transaction_id = models.CharField(max_length=100, unique=True)
    amount_vnd = models.BigIntegerField()
    state = models.CharField(max_length=20, default="PENDING", help_text="PENDING, SUCCEEDED, FAILED")
    method = models.CharField(max_length=50, default="SIMULATION", help_text="SIMULATION, COUNTER")
    attempted_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    source_revision = models.IntegerField(default=1)
    settlement_id = models.UUIDField(null=True, blank=True)
    idempotency_key = models.CharField(max_length=100, blank=True)
    fence = models.IntegerField(default=1)

    class Meta:
        db_table = "payments"
        indexes = [
            models.Index(fields=["state", "paid_at"], name="idx_payments_state_paid"),
        ]

    def __str__(self):
        return f"Payment {self.id} - Tx: {self.transaction_id} ({self.state})"


class Receipt(models.Model):
    """Bảng receipts: Biên nhận điện tử bất biến sau khi thanh toán thành công."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payment = models.OneToOneField(Payment, on_delete=models.CASCADE, related_name="receipt")
    charge = models.ForeignKey(Charge, on_delete=models.CASCADE, related_name="receipts")
    receipt_no = models.CharField(max_length=50, unique=True)
    amount_vnd = models.BigIntegerField()
    issued_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "receipts"

    def __str__(self):
        return f"Receipt {self.receipt_no} - {self.amount_vnd}đ"


class Refund(models.Model):
    """Bảng refunds: Quản lý hoàn tiền khi hủy khám hoặc hủy chỉ định."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    charge = models.ForeignKey(Charge, on_delete=models.CASCADE, related_name="refunds")
    cancellation_id = models.UUIDField(help_text="Khóa chống hoàn tiền trùng lặp")
    reason_code = models.CharField(max_length=50)
    amount_vnd = models.BigIntegerField()
    state = models.CharField(max_length=20, default="REQUESTED", help_text="REQUESTED, SUCCEEDED, FAILED")
    attempts = models.JSONField(default=list, blank=True)
    version = models.IntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "refunds"
        indexes = [
            models.Index(fields=["state", "updated_at"], name="idx_refunds_state_updated"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["charge", "cancellation_id", "reason_code"],
                name="uq_refunds_charge_cancellation"
            )
        ]

    def __str__(self):
        return f"Refund {self.id} for Charge {self.charge.id} ({self.state})"


class BillingEventOutbox(models.Model):
    """Bảng billing_event_outbox: Lưu trữ sự kiện nghiệp vụ trước khi phát qua broker theo Transactional Outbox Pattern."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=100)
    exchange = models.CharField(max_length=200)
    routing_key = models.CharField(max_length=200)
    payload = models.JSONField()
    attempts = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "billing_event_outbox"
        indexes = [
            models.Index(fields=["published_at", "created_at"], name="billing_ev_publis_54e247_idx"),
        ]

    def __str__(self):
        return f"OutboxEvent {self.id} ({self.event_type}) - Published: {self.published_at is not None}"


class IdempotencyRecord(models.Model):
    """Bảng idempotency_records: giữ request hash theo Idempotency-Key.

    02_ThamSo yêu cầu "cùng key với payload khác phải trả 409", nên ngoài việc
    replay kết quả cũ còn phải phát hiện payload đã đổi so với lần ghi đầu.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scope = models.CharField(max_length=40, help_text="API ID sở hữu khóa, ví dụ BI-004")
    key = models.CharField(max_length=100)
    request_hash = models.CharField(max_length=64)
    response = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "idempotency_records"
        constraints = [
            models.UniqueConstraint(fields=["scope", "key"], name="uq_idem_scope_key"),
        ]
        indexes = [
            models.Index(fields=["created_at"], name="idx_idem_created"),
        ]

    def __str__(self):
        return f"Idempotency {self.scope}/{self.key}"


class BillingAuditEvent(models.Model):
    """Bảng billing_audit_events: vết nghiệp vụ tiền.

    BI-007 ghi rõ reasonCode "được ghi vào audit"; bảng này là nơi lưu vết đó,
    tách khỏi audit an ninh của Identity.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    action = models.CharField(max_length=60)
    actor_user_id = models.UUIDField(null=True, blank=True)
    target_id = models.UUIDField(null=True, blank=True)
    payload = models.JSONField(default=dict)
    correlation_id = models.CharField(max_length=64, blank=True)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "billing_audit_events"
        indexes = [
            models.Index(fields=["action", "at"], name="idx_billing_audit_action_at"),
        ]

    def __str__(self):
        return f"BillingAudit {self.action} at {self.at}"
