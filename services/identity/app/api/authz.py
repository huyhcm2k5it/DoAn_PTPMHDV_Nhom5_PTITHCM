"""Xác thực Bearer JWT và kiểm capability cho các API quản trị của Identity."""

import uuid
from functools import wraps

from rest_framework.response import Response

from app.application.token_service import verify_access_token
from app.domain.models import StaffCapability, User


def correlation_id(request):
    return request.headers.get("X-Correlation-Id") or str(uuid.uuid4())


def error_response(request, status, code, message):
    return Response({
        "error": {"code": code, "message": message},
        "meta": {"correlationId": correlation_id(request)},
    }, status=status)


def load_principal(request):
    """Trả (user, payload, None) hoặc (None, None, response lỗi)."""
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None, None, error_response(
            request, 401, "UNAUTHENTICATED", "Thiếu Authorization header."
        )

    try:
        payload = verify_access_token(header[7:].strip())
    except Exception:
        return None, None, error_response(
            request, 401, "UNAUTHENTICATED", "Token không hợp lệ hoặc đã hết hạn."
        )

    # sub phải là UUID; nếu không, filter sẽ ném ValidationError thành 500
    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        return None, None, error_response(
            request, 401, "UNAUTHENTICATED", "Token thiếu hoặc sai định dạng sub."
        )

    user = User.objects.filter(id=user_id).first()
    if not user or user.status != "ACTIVE":
        return None, None, error_response(
            request, 403, "FORBIDDEN", "Tài khoản không tồn tại hoặc đã bị khoá."
        )
    if user.token_version != payload.get("tokenVersion", 1):
        return None, None, error_response(
            request, 401, "UNAUTHENTICATED", "Phiên làm việc đã bị thu hồi."
        )
    return user, payload, None


def require_capability(*capabilities):
    """Chỉ cho qua khi user đang có ít nhất một capability trong danh sách.

    Capability đọc từ DB chứ không tin claim trong token, để việc thu hồi quyền
    có hiệu lực ngay thay vì chờ token cũ hết hạn.
    """

    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            user, payload, error = load_principal(request)
            if error:
                return error
            granted = set(
                StaffCapability.objects.filter(user=user, enabled=True)
                .values_list("capability", flat=True)
            )
            if not granted.intersection(capabilities):
                return error_response(
                    request,
                    403,
                    "FORBIDDEN",
                    "Thiếu quyền bắt buộc: " + " hoặc ".join(capabilities) + ".",
                )
            request.principal = user
            request.principal_payload = payload
            request.granted_capabilities = granted
            return view(request, *args, **kwargs)

        return wrapper

    return decorator
