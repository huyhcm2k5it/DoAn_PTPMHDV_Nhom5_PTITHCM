import uuid

from django.conf import settings
from rest_framework.decorators import api_view
from rest_framework.response import Response

from app.domain.models import DevSmsInbox


def get_correlation_id(request):
    return request.headers.get("X-Correlation-Id") or str(uuid.uuid4())


@api_view(["GET"])
def dev_otp_inbox_view(request):
    """Hộp thư SMS giả lập: đọc lại mã đã gửi cho một số điện thoại.

    Đây là màn hình điện thoại thay thế, không phải API nghiệp vụ: mã trả về
    đúng là mã đã phát sinh ở luồng đăng ký/quên mật khẩu. Bị tắt hoàn toàn khi
    ALLOW_DEV_OTP=false, đúng NFR-02 (không trả OTP ở môi trường thật).
    """
    if not getattr(settings, "ALLOW_DEV_OTP", False):
        return Response({
            "error": {"code": "NOT_FOUND", "message": "Không tìm thấy tài nguyên."},
            "meta": {"correlationId": get_correlation_id(request)},
        }, status=404)

    phone = request.query_params.get("phone", "").strip()
    purpose = request.query_params.get("purpose", "").strip().upper()

    if not phone:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Tham số phone là bắt buộc."},
            "meta": {"correlationId": get_correlation_id(request)},
        }, status=400)

    queryset = DevSmsInbox.objects.filter(phone=phone)
    if purpose:
        queryset = queryset.filter(purpose=purpose)
    latest = queryset.order_by("-created_at").first()

    items = []
    if latest:
        items.append({
            "phone": latest.phone,
            "purpose": latest.purpose,
            "otpCode": latest.body,
            "receivedAt": latest.created_at.isoformat(),
        })

    return Response({
        "data": {"items": items},
        "meta": {"correlationId": get_correlation_id(request)},
    }, status=200)
