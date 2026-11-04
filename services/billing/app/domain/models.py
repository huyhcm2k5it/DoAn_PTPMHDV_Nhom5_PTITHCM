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
        constraints = [
            models.UniqueConstraint(
                fields=["charge", "cancellation_id", "reason_code"],
                name="uq_refunds_charge_cancellation"
            )
        ]

    def __str__(self):
        return f"Refund {self.id} for Charge {self.charge.id} ({self.state})"