import uuid

from rest_framework.decorators import api_view
from rest_framework.response import Response

from app.auth.jwt_auth import authenticated, can_read_patient_resource, patient_scope_error
from app.domain.models import Receipt


def get_correlation_id(request):
    return request.headers.get("X-Correlation-Id", str(uuid.uuid4()))


@api_view(["GET"])
@authenticated
def receipt_detail_view(request, receipt_id):
    """BI-006: Lấy biên nhận điện tử theo receiptId."""
    correlation_id = get_correlation_id(request)

    try:
        receipt = Receipt.objects.select_related("payment", "charge").get(id=receipt_id)
    except Receipt.DoesNotExist:
        return Response({
            "error": {
                "code": "NOT_FOUND",
                "message": f"Biên nhận {receipt_id} không tồn tại."
            },
            "meta": {"correlationId": correlation_id}
        }, status=404)

    if not can_read_patient_resource(request.principal, receipt.charge.patient_id):
        return patient_scope_error(request)

    return Response({
        "data": {
            "receipt": {
                "id": str(receipt.id),
                "receiptNo": receipt.receipt_no,
                "paymentId": str(receipt.payment.id),
                "chargeId": str(receipt.charge.id),
                "amountVnd": receipt.amount_vnd,
                "issuedAt": receipt.issued_at.isoformat() if receipt.issued_at else None
            }
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)
