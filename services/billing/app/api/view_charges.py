import uuid
from rest_framework.decorators import api_view
from rest_framework.response import Response
from app.domain.models import Charge, Payment, SettlementSaga, Refund

def get_correlation_id(request):
    return request.headers.get("X-Correlation-Id", str(uuid.uuid4()))

@api_view(["GET"])
def charges_list_view(request):
    """BI-013: CASHIER xem danh sách khoản thu theo trạng thái và thời gian."""
    correlation_id = get_correlation_id(request)
    state = request.query_params.get("state")
    page = int(request.query_params.get("page", 1))
    limit = min(int(request.query_params.get("limit", 20)), 100)

    queryset = Charge.objects.all().order_by("-created_at")
    if state:
        queryset = queryset.filter(state=state.upper())

    total = queryset.count()
    start = (page - 1) * limit
    charges = queryset[start:start + limit]

    items = [
        {
            "id": str(c.id),
            "patientId": str(c.patient_id),
            "sourceType": c.source_type,
            "sourceId": str(c.source_id),
            "sourceRevision": c.source_revision,
            "amountVnd": c.amount_vnd,
            "state": c.state,
            "settlementState": c.settlement_state,
            "createdAt": c.created_at.isoformat() if c.created_at else None,
        }
        for c in charges
    ]

    return Response({
        "data": {
            "items": items,
            "total": total
        },
        "meta": {
            "correlationId": correlation_id
        }
    }, status=200)


@api_view(["GET"])
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

    # Truy vấn xuôi qua Model để Pylance nhận diện kiểu chuẩn xác
    latest_payment = Payment.objects.filter(charge=charge).order_by("-attempted_at").first()
    latest_saga = SettlementSaga.objects.filter(charge=charge).order_by("-created_at").first()
    latest_refund = Refund.objects.filter(charge=charge).order_by("-updated_at").first()

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
                "transactionId": latest_payment.transaction_id,
                "amountVnd": latest_payment.amount_vnd,
                "state": latest_payment.state,
                "method": latest_payment.method,
                "paidAt": latest_payment.paid_at.isoformat() if latest_payment.paid_at else None,
            } if latest_payment else None,
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