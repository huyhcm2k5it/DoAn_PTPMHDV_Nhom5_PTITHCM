import uuid
from datetime import datetime

from django.db.models import Sum
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from app.api.querying import vn_day_window
from app.auth.jwt_auth import require_staff
from app.domain.models import Payment, Refund


def get_correlation_id(request):
    return request.headers.get("X-Correlation-Id", str(uuid.uuid4()))


@api_view(["GET"])
@require_staff("ADMIN")
def revenue_report_view(request):
    """BI-010: Báo cáo thu/hoàn viện phí cho ADMIN (route chuẩn: /api/v1/admin/reports/summary)."""
    correlation_id = get_correlation_id(request)
    from_date = request.query_params.get("from")
    to_date = request.query_params.get("to")

    if not from_date or not to_date:
        return Response({
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Cần cung cấp đủ tham số query 'from' và 'to' (định dạng YYYY-MM-DD)."
            },
            "meta": {"correlationId": correlation_id}
        }, status=400)

    try:
        parsed_from = datetime.strptime(from_date, "%Y-%m-%d").date()
        parsed_to = datetime.strptime(to_date, "%Y-%m-%d").date()
    except ValueError:
        return Response({
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Định dạng ngày 'from' hoặc 'to' không hợp lệ (yêu cầu YYYY-MM-DD)."
            },
            "meta": {"correlationId": correlation_id}
        }, status=400)

    if parsed_from > parsed_to:
        return Response({
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Tham số 'from' không được lớn hơn 'to'."
            },
            "meta": {"correlationId": correlation_id}
        }, status=400)

    # Kỳ báo cáo tính theo ngày Việt Nam rồi quy về UTC để so với cột lưu trữ.
    # 02_ThamSo: 'to' là biên loại trừ nên dừng ngay tại đầu ngày 'to'.
    window_start = vn_day_window(parsed_from)
    window_end = vn_day_window(parsed_to)

    received_vnd = Payment.objects.filter(
        state="SUCCEEDED",
        paid_at__gte=window_start,
        paid_at__lt=window_end
    ).aggregate(total=Sum("amount_vnd"))["total"] or 0

    # Lưu ý: chưa có cột thời điểm hoàn tất riêng nên tạm dùng updated_at của refund SUCCEEDED.
    refunded_vnd = Refund.objects.filter(
        state="SUCCEEDED",
        updated_at__gte=window_start,
        updated_at__lt=window_end
    ).aggregate(total=Sum("amount_vnd"))["total"] or 0

    return Response({
        "data": {
            "receivedVnd": received_vnd,
            "refundedVnd": refunded_vnd,
            "asOf": timezone.now().isoformat()
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)
