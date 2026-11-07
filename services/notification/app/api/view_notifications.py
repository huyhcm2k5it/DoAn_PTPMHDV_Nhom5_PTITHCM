"""NO-001 và NO-002: đọc và đánh dấu đã đọc thông báo của chính tài khoản."""

import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from app.api.authz import authenticated
from app.domain.models import Notification

MAX_IDEMPOTENCY_KEY = 100

def get_correlation_id(request):
    return request.headers.get("X-Correlation-Id") or str(uuid.uuid4())

def validation_error(request, message):
    return Response({
        "error": {"code": "VALIDATION_ERROR", "message": message},
        "meta": {"correlationId": get_correlation_id(request)},
    }, status=400)

def serialize(notification):
    return {
        "id": str(notification.id),
        "kind": notification.kind,
        "title": notification.title,
        "body": notification.body,
        "payload": notification.payload,
        "readAt": notification.read_at.isoformat() if notification.read_at else None,
        "createdAt": notification.created_at.isoformat(),
    }

@api_view(["GET"])
@authenticated
def notifications_list_view(request):
    """NO-001: danh sách thông báo của tài khoản hiện tại, mới nhất trước."""
    correlation_id = get_correlation_id(request)

    try:
        page = int(request.query_params.get("page", 1))
        limit = int(request.query_params.get("limit", 20))
        if page < 1 or limit < 1 or limit > 100:
            raise ValueError()
    except (ValueError, TypeError):
        return validation_error(
            request, "Tham số phân trang page phải >= 1 và limit nằm trong khoảng 1-100."
        )

    unread_raw = request.query_params.get("unreadOnly")
    unread_only = False
    if unread_raw is not None and unread_raw != "":
        if unread_raw.lower() not in ("true", "false"):
            return validation_error(request, "unreadOnly chỉ nhận true hoặc false.")
        unread_only = unread_raw.lower() == "true"

    queryset = Notification.objects.filter(user_id=request.principal.user_id).order_by("-created_at")
    if unread_only:
        queryset = queryset.filter(read_at__isnull=True)

    total = queryset.count()
    start = (page - 1) * limit
    items = [serialize(item) for item in queryset[start:start + limit]]

    return Response({
        "data": {"items": items, "total": total},
        "meta": {"correlationId": correlation_id},
    }, status=200)


@api_view(["PATCH"])
@authenticated
def mark_read_view(request, notification_id):
    """NO-002: đánh dấu một thông báo của chính tài khoản đã đọc.

    Lặp lại không tạo trạng thái mới: readAt giữ nguyên thời điểm đọc đầu tiên.
    """
    correlation_id = get_correlation_id(request)

    idempotency_key = request.headers.get("Idempotency-Key", "").strip()
    if not idempotency_key:
        return validation_error(request, "Thiếu header bắt buộc Idempotency-Key.")
    if len(idempotency_key) > MAX_IDEMPOTENCY_KEY:
        return validation_error(
            request, f"Idempotency-Key tối đa {MAX_IDEMPOTENCY_KEY} ký tự."
        )

    with transaction.atomic():
        notification = (
            Notification.objects.select_for_update()
            .filter(id=notification_id, user_id=request.principal.user_id)
            .first()
        )
        if not notification:
            # Không phân biệt "không tồn tại" với "của người khác" để không lộ dữ liệu
            return Response({
                "error": {
                    "code": "NOT_FOUND",
                    "message": f"Thông báo {notification_id} không tồn tại.",
                },
                "meta": {"correlationId": correlation_id},
            }, status=404)

        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at"])

        read_at = notification.read_at

    return Response({
        "data": {
            "notificationId": str(notification_id),
            "readAt": read_at.isoformat(),
        },
        "meta": {"correlationId": correlation_id},
    }, status=200)
