import uuid

from django.db import IntegrityError, transaction
from rest_framework.decorators import api_view
from rest_framework.response import Response

from app.api import idempotency
from app.auth.lease import require_lease
from app.auth.jwt_auth import authenticated, require_staff
from app.domain.models import Charge, Payment, SettlementSaga, BillingEventOutbox
from app.auth.jwt_auth import can_read_patient_resource, patient_scope_error
from app.infrastructure.message_delivery import make_envelope, digest, OWNERS
from django.utils import timezone
from datetime import timedelta


def get_correlation_id(request):
    return request.headers.get("X-Correlation-Id", str(uuid.uuid4()))


def request_id_for(scope, charge_id, idempotency_key):
    """requestId ổn định theo (scope, charge, Idempotency-Key).

    Dùng uuid5 thay vì uuid4 để client polling nhận cùng một requestId khi retry
    cùng một ý định thanh toán, đúng ngữ nghĩa idempotency.
    """
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"umc-care:billing:{scope}:{charge_id}:{idempotency_key}"))


def payment_data(payment, request_id):
    return {
        "requestId": request_id,
        "paymentId": str(payment.id),
        "state": payment.state,
        "statusUrl": f"/api/v1/charges/{payment.charge_id}",
    }


def accepted_data_response(request, data):
    response = Response({
        "data": data,
        "meta": {"correlationId": get_correlation_id(request)}
    }, status=202)
    response["Location"] = data["statusUrl"]
    return response


def validation_error(request, message):
    return Response({
        "error": {"code": "VALIDATION_ERROR", "message": message},
        "meta": {"correlationId": get_correlation_id(request)}
    }, status=400)


def duplicate_transaction(request):
    return Response({
        "error": {
            "code": "DUPLICATE_TRANSACTION",
            "message": "Mã giao dịch transactionId đã được sử dụng cho thanh toán khác."
        },
        "meta": {"correlationId": get_correlation_id(request)}
    }, status=409)


def require_idempotency_key(request):
    key = request.headers.get("Idempotency-Key", "").strip()
    if not key:
        return None, validation_error(request, "Thiếu header bắt buộc Idempotency-Key.")
    if len(key) > 100:
        return None, validation_error(request, "Idempotency-Key tối đa 100 ký tự.")
    return key, None


def settle_payment(
    request, charge_uuid, transaction_id, method, idempotency_key, scope, payload, request_id
):
    """Tạo saga + payment PENDING trong một transaction, kèm bản ghi idempotency.

    Trả (data, None) khi thành công hoặc (None, response_lỗi) để view trả ngay.
    """
    correlation_id = get_correlation_id(request)
    try:
        with transaction.atomic():
            try:
                charge = Charge.objects.select_for_update().get(id=charge_uuid)
            except Charge.DoesNotExist:
                return None, Response({
                    "error": {
                        "code": "NOT_FOUND",
                        "message": f"Khoản thu {charge_uuid} không tồn tại."
                    },
                    "meta": {"correlationId": correlation_id}
                }, status=404)

            if not can_read_patient_resource(request.principal, charge.patient_id):
                return None, patient_scope_error(request)
            # Kiểm tra lại sau khi đã giữ khóa dòng charge để chặn hai request song song
            data, conflict = idempotency.replay(scope, idempotency_key, payload)
            if conflict:
                return None, idempotency.conflict_response(request, correlation_id)
            if data is not None:
                return data, None

            if charge.state != "OPEN" or charge.settlement_state in ("REQUESTED", "RESERVED", "IN_DOUBT", "SUCCEEDED") or (charge.expires_at and charge.expires_at <= timezone.now()) or charge.source_type not in OWNERS:
                return None, Response({
                    "error": {
                        "code": "CHARGE_NOT_PAYABLE",
                        "message": (
                            f"Khoản thu này không ở trạng thái mở để thanh toán "
                            f"(trạng thái hiện tại: {charge.state}, settlement: {charge.settlement_state})."
                        )
                    },
                    "meta": {"correlationId": correlation_id}
                }, status=409)

            saga = SettlementSaga.objects.create(
                charge=charge,
                source_type=charge.source_type,
                source_id=charge.source_id,
                source_revision=charge.source_revision,
                state="REQUESTED",
                version=(SettlementSaga.objects.filter(charge=charge).order_by("-version").values_list("version", flat=True).first() or 0) + 1,
                fence=None,
                amount_hash=charge.snapshot_hash,
                deadline_at=timezone.now() + timedelta(seconds=60)
            )

            payment = Payment.objects.create(
                charge=charge,
                saga=saga,
                transaction_id=transaction_id,
                amount_vnd=charge.amount_vnd,
                state="PENDING",
                method=method,
                idempotency_key=idempotency_key,
                settlement_id=saga.id,
                source_revision=charge.source_revision,
                fence=0
            )

            reserve = {"settlementId": str(saga.id), "chargeId": str(charge.id), "sourceType": charge.source_type,
                "sourceId": str(charge.source_id), "sourceRevision": charge.source_revision,
                "amountHash": saga.amount_hash, "attemptVersion": saga.version}
            BillingEventOutbox.objects.create(event_type="ReserveSettlement", exchange="umc.commands.billing.v1",
                routing_key=OWNERS[charge.source_type] + ".reserve-settlement.v1",
                payload=make_envelope("ReserveSettlement", reserve, saga.id, saga.version, kind="COMMAND"))
            charge.settlement_id = saga.id
            charge.settlement_saga_id = saga.id
            charge.settlement_state = "REQUESTED"
            charge.save(update_fields=["settlement_saga_id", "settlement_state", "settlement_id"])

            data = payment_data(payment, request_id)
            idempotency.remember(scope, idempotency_key, payload, data)
            return data, None
    except IntegrityError:
        # Hai request đồng thời cùng transactionId: transaction đã rollback, không tạo saga rác
        return None, duplicate_transaction(request)


@api_view(["POST"])
@authenticated
@require_lease("BI-004")
def simulate_payment_view(request):
    """BI-004: Giả lập thanh toán cho khoản thu, tạo payment PENDING và saga REQUESTED.

    Actor: PATIENT (thanh toán khoản của mình) hoặc STAFF[CASHIER] thu hộ.
    """
    correlation_id = get_correlation_id(request)
    principal = request.principal
    is_cashier = principal.actor_type == "STAFF" and principal.has("CASHIER")
    if principal.actor_type != "PATIENT":
        return Response({
            "error": {
                "code": "FORBIDDEN",
                "message": "Chỉ PATIENT hoặc STAFF[CASHIER] được tạo thanh toán."
            },
            "meta": {"correlationId": correlation_id}
        }, status=403)

    idempotency_key, error = require_idempotency_key(request)
    if error:
        return error

    if not isinstance(request.data, dict):
        return validation_error(request, "Dữ liệu payload phải là JSON object.")

    charge_id = request.data.get("chargeId")
    transaction_id = str(request.data.get("transactionId", "")).strip()

    if not charge_id or not transaction_id:
        return validation_error(request, "Trường chargeId và transactionId là bắt buộc.")

    if len(transaction_id) > 100:
        return validation_error(request, "Trường transactionId tối đa 100 ký tự.")

    try:
        charge_uuid = uuid.UUID(str(charge_id))
    except (ValueError, TypeError):
        return validation_error(request, "Trường chargeId phải là UUID hợp lệ.")

    charge = Charge.objects.filter(id=charge_uuid).first()
    if charge and not can_read_patient_resource(principal, charge.patient_id):
        return patient_scope_error(request)
    scope = "BI-004:" + uuid.uuid5(uuid.NAMESPACE_URL, principal.user_id + str(charge_uuid)).hex
    payload = {"chargeId": str(charge_uuid), "transactionId": transaction_id}
    request_id = request_id_for("payment", charge_uuid, idempotency_key)

    # Cùng key + cùng payload: replay kết quả cũ, kể cả khi charge đã PAID.
    # Cùng key + payload khác: 409 theo 02_ThamSo.
    data, conflict = idempotency.replay(scope, idempotency_key, payload)
    if conflict:
        return idempotency.conflict_response(request, correlation_id)
    if data is not None:
        return accepted_data_response(request, data)

    # Chống trùng mã giao dịch ngoài đời thực
    if Payment.objects.filter(transaction_id=transaction_id).exists():
        return duplicate_transaction(request)

    data, error = settle_payment(
        request, charge_uuid, transaction_id, "SIMULATION",
        idempotency_key, scope, payload, request_id,
    )
    if error:
        return error
    return accepted_data_response(request, data)


@api_view(["POST"])
@require_staff("CASHIER")
@require_lease("BI-005")
def counter_payment_view(request):
    """BI-005: Thu viện phí tại quầy bệnh viện (CASHIER)."""
    correlation_id = get_correlation_id(request)

    idempotency_key, error = require_idempotency_key(request)
    if error:
        return error

    if not isinstance(request.data, dict):
        return validation_error(request, "Dữ liệu payload phải là JSON object.")

    charge_id = request.data.get("chargeId")
    transaction_id = str(request.data.get("transactionId", "")).strip()
    counter_reference = str(request.data.get("counterReference", "")).strip()

    if not charge_id or not transaction_id or not counter_reference:
        return validation_error(
            request, "Các trường chargeId, transactionId và counterReference là bắt buộc."
        )

    if len(transaction_id) > 100:
        return validation_error(request, "Trường transactionId tối đa 100 ký tự.")
    if len(counter_reference) > 100:
        return validation_error(request, "Trường counterReference tối đa 100 ký tự.")

    try:
        charge_uuid = uuid.UUID(str(charge_id))
    except (ValueError, TypeError):
        return validation_error(request, "Trường chargeId phải là UUID hợp lệ.")

    scope = "BI-005:" + uuid.uuid5(uuid.NAMESPACE_URL, request.principal.user_id + str(charge_uuid)).hex
    payload = {
        "chargeId": str(charge_uuid),
        "transactionId": transaction_id,
        "counterReference": counter_reference,
    }
    request_id = request_id_for("counter", charge_uuid, idempotency_key)

    data, conflict = idempotency.replay(scope, idempotency_key, payload)
    if conflict:
        return idempotency.conflict_response(request, correlation_id)
    if data is not None:
        return accepted_data_response(request, data)

    # Chống thu lặp cùng một mã giao dịch
    if Payment.objects.filter(transaction_id=transaction_id).exists():
        return duplicate_transaction(request)

    data, error = settle_payment(
        request, charge_uuid, transaction_id, "COUNTER",
        idempotency_key, scope, payload, request_id,
    )
    if error:
        return error
    return accepted_data_response(request, data)
