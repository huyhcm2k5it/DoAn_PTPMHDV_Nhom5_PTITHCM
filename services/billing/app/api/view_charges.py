import uuid

from rest_framework.decorators import api_view
from rest_framework.response import Response

from app.api.querying import parse_date_param, vn_day_window
from app.auth.jwt_auth import (
    authenticated,
    can_read_patient_resource,
    patient_scope_error,
    require_staff,
)
from app.domain.models import Charge, Payment, SettlementSaga, Refund, Receipt

CHARGE_STATES = ("OPEN", "PAID", "VOID")


def get_correlation_id(request):
    return request.headers.get("X-Correlation-Id", str(uuid.uuid4()))


def parse_pagination(request):
    """Trả về (page, limit, None) hoặc (None, None, response lỗi 400)."""
    try:
        page = int(request.query_params.get("page", 1))
        limit = int(request.query_params.get("limit", 20))
        if page < 1 or limit < 1 or limit > 100:
            raise ValueError()
    except (ValueError, TypeError):
        return None, None, Response({
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Tham số phân trang page phải >= 1 và limit nằm trong khoảng 1-100."
            },
            "meta": {"correlationId": get_correlation_id(request)}
        }, status=400)
    return page, limit, None


def parse_state(request, allowed):
    """Chuẩn hoá và kiểm tra giá trị lọc state; trả về (state, None) hoặc (None, response lỗi)."""
    raw = request.query_params.get("state")
    if not raw:
        return None, None
    value = raw.strip().upper()
    if value not in allowed:
        return None, Response({
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Giá trị state không hợp lệ, chỉ chấp nhận: " + ", ".join(allowed) + "."
            },
            "meta": {"correlationId": get_correlation_id(request)}
        }, status=400)
    return value, None


def parse_window(request):
    """Đọc cặp from/to; trả (from, to, response lỗi).

    02_ThamSo: 'from' bao gồm mốc, 'to' loại trừ mốc.
    """
    parsed_from, bad_from = parse_date_param(request.query_params.get("from"))
    if bad_from:
        return None, None, Response({
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Tham số 'from' phải có định dạng YYYY-MM-DD hợp lệ."
            },
            "meta": {"correlationId": get_correlation_id(request)}
        }, status=400)

    parsed_to, bad_to = parse_date_param(request.query_params.get("to"))
    if bad_to:
        return None, None, Response({
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Tham số 'to' phải có định dạng YYYY-MM-DD hợp lệ."
            },
            "meta": {"correlationId": get_correlation_id(request)}
        }, status=400)

    if parsed_from and parsed_to and parsed_from > parsed_to:
        return None, None, Response({
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Tham số 'from' không được lớn hơn 'to'."
            },
            "meta": {"correlationId": get_correlation_id(request)}
        }, status=400)

    return parsed_from, parsed_to, None


def apply_window(queryset, parsed_from, parsed_to):
    if parsed_from:
        queryset = queryset.filter(created_at__gte=vn_day_window(parsed_from))
    if parsed_to:
        queryset = queryset.filter(created_at__lt=vn_day_window(parsed_to))
    return queryset


def serialize_charge(charge):
    return {
        "id": str(charge.id),
        "patientId": str(charge.patient_id),
        "sourceType": charge.source_type,
        "sourceId": str(charge.source_id),
        "sourceRevision": charge.source_revision,
        "amountVnd": charge.amount_vnd,
        "state": charge.state,
        "settlementState": charge.settlement_state,
        "createdAt": charge.created_at.isoformat() if charge.created_at else None,
    }


@api_view(["GET"])
@require_staff("CASHIER")
def charges_list_view(request):
    """BI-013: CASHIER xem danh sách khoản thu theo trạng thái và thời gian."""
    correlation_id = get_correlation_id(request)
    page, limit, error = parse_pagination(request)
    if error is not None:
        return error
    state, error = parse_state(request, CHARGE_STATES)
    if error is not None:
        return error
    parsed_from, parsed_to, error = parse_window(request)
    if error is not None:
        return error

    assert page is not None
    assert limit is not None

    queryset = Charge.objects.all().order_by("-created_at")
    if state:
        queryset = queryset.filter(state=state)
    queryset = apply_window(queryset, parsed_from, parsed_to)

    total = queryset.count()
    start = (page - 1) * limit
    charges = queryset[start:start + limit]

    return Response({
        "data": {
            "items": [serialize_charge(c) for c in charges],
            "total": total
        },
        "meta": {
            "correlationId": correlation_id
        }
    }, status=200)


@api_view(["GET"])
@authenticated
def charge_detail_view(request, charge_id):
    """BI-002: Lấy chi tiết charge cùng latestPayment, saga và refundState."""
    correlation_id = get_correlation_id(request)

    try:
        charge = Charge.objects.get(id=charge_id)
    except Charge.DoesNotExist:
        return Response({
            "error": {
                "code": "NOT_FOUND",
                "message": f"Khoản thu {charge_id} không tồn tại."
            },
            "meta": {"correlationId": correlation_id}
        }, status=404)

    if not can_read_patient_resource(request.principal, charge.patient_id):
        return patient_scope_error(request)

    # Truy vấn xuôi qua Model để Pylance nhận diện kiểu chuẩn xác
    latest_payment = Payment.objects.filter(charge=charge).order_by("-attempted_at").first()
    latest_saga = SettlementSaga.objects.filter(charge=charge).order_by("-created_at").first()
    latest_refund = Refund.objects.filter(charge=charge).order_by("-updated_at").first()
    latest_receipt = Receipt.objects.filter(charge=charge).order_by("-issued_at").first()
    latest_receipt_id = str(latest_receipt.id) if latest_receipt else None
    latest_payment_paid_at = None
    if latest_payment is not None:
        latest_payment_paid_at = latest_payment.paid_at.isoformat() if latest_payment.paid_at else None

    return Response({
        "data": {
            "charge": {
                "id": str(charge.id),
                "patientId": str(charge.patient_id),
                "sourceType": charge.source_type,
                "sourceId": str(charge.source_id),
                "sourceRevision": charge.source_revision,
                "amountVnd": charge.amount_vnd,
                "state": charge.state,
                "settlementState": charge.settlement_state,
                "priceSnapshot": charge.price_snapshot,
                "createdAt": charge.created_at.isoformat() if charge.created_at else None,
                "updatedAt": charge.updated_at.isoformat() if charge.updated_at else None,
            },
            "latestPayment": {
                "id": str(latest_payment.id),
                "receiptId": latest_receipt_id,
                "transactionId": latest_payment.transaction_id,
                "amountVnd": latest_payment.amount_vnd,
                "state": latest_payment.state,
                "method": latest_payment.method,
                "paidAt": latest_payment_paid_at,
            } if latest_payment else None,
            "receiptId": latest_receipt_id,
            "saga": {
                "id": str(latest_saga.id),
                "state": latest_saga.state,
                "fence": latest_saga.fence
            } if latest_saga else None,
            "refundState": latest_refund.state if latest_refund else "NONE"
        },
        "meta": {
            "correlationId": correlation_id
        }
    }, status=200)


@api_view(["GET"])
@authenticated
def patient_charges_list_view(request, patient_id):
    """BI-003: Lấy các khoản thu của hồ sơ bệnh nhân theo quyền."""
    correlation_id = get_correlation_id(request)
    page, limit, error = parse_pagination(request)
    if error is not None:
        return error
    state, error = parse_state(request, CHARGE_STATES)
    if error is not None:
        return error

    assert page is not None
    assert limit is not None

    if not can_read_patient_resource(request.principal, patient_id):
        return patient_scope_error(request)

    queryset = Charge.objects.filter(patient_id=patient_id).order_by("-created_at")
    if state:
        queryset = queryset.filter(state=state)

    total = queryset.count()
    start = (page - 1) * limit
    charges = queryset[start:start + limit]

    return Response({
        "data": {
            "items": [serialize_charge(c) for c in charges],
            "total": total
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)
