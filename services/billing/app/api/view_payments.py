import uuid
from rest_framework.decorators import api_view
from rest_framework.response import Response
from app.domain.models import Charge, SettlementSaga, Payment

def get_correlation_id(request):
    return request.headers.get("X-Correlation-Id", str(uuid.uuid4()))

@api_view(["POST"])
def simulate_payment_view(request):
    """BI-004: Giả lập thanh toán cho khoản thu, tạo payment PENDING và saga REQUESTED."""
    correlation_id = get_correlation_id(request)
    idempotency_key = request.headers.get("Idempotency-Key", "").strip()

    # 1. Bắt buộc có header Idempotency-Key theo chuẩn contract
    if not idempotency_key:
        return Response({
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Thiếu header bắt buộc Idempotency-Key."
            },
            "meta": {"correlationId": correlation_id}
        }, status=400)

    charge_id = request.data.get("chargeId")
    transaction_id = request.data.get("transactionId", "").strip()

    # 2. Kiểm tra dữ liệu đầu vào
    if not charge_id or not transaction_id:
        return Response({
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Trường chargeId và transactionId là bắt buộc."
            },
            "meta": {"correlationId": correlation_id}
        }, status=400)

    # 3. Kiểm tra khoản thu
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

    if charge.state == "PAID":
        return Response({
            "error": {
                "code": "CHARGE_NOT_PAYABLE",
                "message": "Khoản thu này đã được thanh toán trước đó."
            },
            "meta": {"correlationId": correlation_id}
        }, status=409)

    # 4. Kiểm tra chống trùng transactionId
    existing_tx = Payment.objects.filter(transaction_id=transaction_id).exclude(idempotency_key=idempotency_key).first()
    if existing_tx:
        return Response({
            "error": {
                "code": "DUPLICATE_TRANSACTION",
                "message": "Mã giao dịch transactionId đã được sử dụng cho thanh toán khác."
            },
            "meta": {"correlationId": correlation_id}
        }, status=409)

    # 5. Xử lý Idempotency nếu request gửi lại cùng key
    existing_payment = Payment.objects.filter(idempotency_key=idempotency_key, charge=charge).first()
    if existing_payment:
        status_url = f"/api/v1/charges/{charge.id}"
        response = Response({
            "data": {
                "requestId": str(uuid.uuid4()),
                "paymentId": str(existing_payment.id),
                "state": existing_payment.state,
                "statusUrl": status_url
            },
            "meta": {"correlationId": correlation_id}
        }, status=202)
        response["Location"] = status_url
        return response

    # 6. Khởi tạo Saga và Payment PENDING
    saga = SettlementSaga.objects.create(
        charge=charge,
        source_type=charge.source_type,
        source_id=charge.source_id,
        source_revision=charge.source_revision,
        state="REQUESTED",
        fence=1
    )

    payment = Payment.objects.create(
        charge=charge,
        saga=saga,
        transaction_id=transaction_id,
        amount_vnd=charge.amount_vnd,
        state="PENDING",
        method="SIMULATION",
        idempotency_key=idempotency_key,
        fence=1
    )

    # Cập nhật trạng thái đối soát trên charge
    charge.settlement_saga_id = saga.id
    charge.settlement_state = "REQUESTED"
    charge.save(update_fields=["settlement_saga_id", "settlement_state"])

    # 7. Trả về mã 202 Accepted kèm header Location và statusUrl theo chuẩn RESTful Saga
    status_url = f"/api/v1/charges/{charge.id}"
    response = Response({
        "data": {
            "requestId": str(uuid.uuid4()),
            "paymentId": str(payment.id),
            "state": payment.state,
            "statusUrl": status_url
        },
        "meta": {"correlationId": correlation_id}
    }, status=202)
    response["Location"] = status_url
    return response