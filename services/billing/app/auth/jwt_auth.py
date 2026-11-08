"""Xác thực Bearer JWT (RS256) do Identity phát hành cho các API Billing.

Gateway chỉ bảo đảm "có token hợp lệ"; quyền theo actor/capability phải do
service sở hữu dữ liệu kiểm tra lại. Module này là điểm kiểm tra duy nhất của
Billing để tránh mỗi view tự parse token một kiểu.

Claim lấy từ Identity (xem `services/identity/app/application/token_service.py`):
    iss=umc-care-identity, aud=umc-care-services,
    sub=<userId>, actorType=PATIENT|STAFF|DOCTOR, capabilities=[...], tokenVersion=<int>
"""

import os
import uuid
from dataclasses import dataclass, field
from functools import wraps
from pathlib import Path

import jwt
from rest_framework.response import Response

ISSUER = os.getenv("JWT_ISSUER", "umc-care-identity")
AUDIENCE = os.getenv("JWT_AUDIENCE", "umc-care-services")

_KEY_CACHE = {}


class AuthError(Exception):
    """Lỗi xác thực/phân quyền, được view chuyển thành response lỗi chuẩn."""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Principal:
    """Danh tính đã xác thực của người gọi."""

    user_id: str
    actor_type: str
    capabilities: tuple = ()
    token_version: int = 1
    claims: dict = field(default_factory=dict)

    def has(self, capability):
        return capability in self.capabilities


def _candidate_paths():
    explicit = os.getenv("JWT_PUBLIC_KEY_PATH")
    if explicit:
        return [Path(explicit)]
    billing_root = Path(__file__).resolve().parents[2]
    return [
        billing_root / "jwt_public.pem",
        billing_root.parent.parent / "infra" / "certs" / "jwt_public.pem",
    ]


def _public_key():
    """Đọc public key theo đường dẫn cấu hình, cache theo (path, mtime) để rotate được."""
    for path in _candidate_paths():
        if not path.is_file():
            continue
        mtime = path.stat().st_mtime
        cached = _KEY_CACHE.get(str(path))
        if cached and cached[0] == mtime:
            return cached[1]
        key = path.read_text(encoding="utf-8")
        _KEY_CACHE[str(path)] = (mtime, key)
        return key
    raise AuthError(503, "AUTH_KEY_UNAVAILABLE", "Không tải được public key để xác thực token.")


def _decode(token):
    try:
        return jwt.decode(
            token,
            _public_key(),
            algorithms=["RS256"],
            issuer=ISSUER,
            audience=AUDIENCE,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise AuthError(401, "TOKEN_EXPIRED", "Token đã hết hạn, cần đăng nhập lại.")
    except jwt.InvalidTokenError:
        raise AuthError(401, "UNAUTHENTICATED", "Token không hợp lệ.")


def authenticate(request):
    """Trả về Principal hoặc ném AuthError. Không bao giờ cho qua khi thiếu token."""
    header = request.headers.get("Authorization", "")
    parts = header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AuthError(401, "UNAUTHENTICATED", "Thiếu header Authorization: Bearer <token>.")
    claims = _decode(parts[1])
    if claims.get("action") or claims.get("tokenType") not in (None, "ACCESS") or claims.get("actorType") not in ("PATIENT", "STAFF", "DOCTOR"):
        raise AuthError(401, "UNAUTHENTICATED", "Access token required.")
    capabilities = claims.get("capabilities") or []
    if not isinstance(capabilities, list):
        raise AuthError(401, "UNAUTHENTICATED", "Claim capabilities không hợp lệ.")
    return Principal(
        user_id=str(claims["sub"]),
        actor_type=str(claims.get("actorType") or ""),
        capabilities=tuple(str(item) for item in capabilities),
        token_version=int(claims.get("tokenVersion") or 1),
        claims=claims,
    )


def error_response(request, error):
    correlation_id = request.headers.get("X-Correlation-Id") or str(uuid.uuid4())
    return Response(
        {
            "error": {"code": error.code, "message": error.message},
            "meta": {"correlationId": correlation_id},
        },
        status=error.status,
    )


def authenticated(view):
    """Bắt buộc có token hợp lệ, gắn `request.principal`."""

    @wraps(view)
    def wrapper(request, *args, **kwargs):
        try:
            request.principal = authenticate(request)
        except AuthError as error:
            return error_response(request, error)
        return view(request, *args, **kwargs)

    return wrapper


def _require(actor_types, capabilities, view):
    @wraps(view)
    @authenticated
    def wrapper(request, *args, **kwargs):
        principal = request.principal
        if principal.actor_type not in actor_types:
            return error_response(
                request,
                AuthError(
                    403,
                    "FORBIDDEN",
                    f"Tác nhân {principal.actor_type or 'không xác định'} không được phép gọi API này.",
                ),
            )
        if capabilities and not any(principal.has(item) for item in capabilities):
            return error_response(
                request,
                AuthError(
                    403,
                    "FORBIDDEN",
                    "Thiếu quyền bắt buộc: " + " hoặc ".join(capabilities) + ".",
                ),
            )
        return view(request, *args, **kwargs)

    return wrapper


def require_staff(*capabilities):
    """Chỉ STAFF và phải có ít nhất một capability được liệt kê."""

    def decorator(view):
        return _require(("STAFF",), capabilities, view)

    return decorator


def can_read_patient_resource(principal, patient_id):
    """Quyền đọc tài nguyên gắn với một bệnh nhân.

    STAFF[CASHIER] được đọc theo quyền tác vụ. PATIENT chỉ được đọc tài nguyên
    của chính mình, nhưng Billing chưa có ánh xạ patientId -> ownerUserId
    (Patient Service giữ `ownerUserId`, Billing chỉ nhận `patientId` trong
    RequestCharge). Vì vậy nhánh PATIENT đang đóng lại theo nguyên tắc fail-closed
    thay vì cho đọc toàn bộ. Khi Billing tiêu thụ `PatientAccessChanged` và dựng
    bảng chiếu ownerUserId, chỉ cần thay nhánh dưới bằng so sánh chủ sở hữu.
    """
    if principal.actor_type == "STAFF":
        return principal.has("CASHIER")
    if principal.actor_type == "PATIENT":
        from app.domain.models import PatientAccessProjection
        return PatientAccessProjection.objects.filter(patient_id=patient_id, owner_user_id=principal.user_id, active=True).exists()
    return False


def patient_scope_error(request):
    return error_response(
        request,
        AuthError(
            403,
            "FORBIDDEN",
            "Chưa xác minh được quyền sở hữu hồ sơ bệnh nhân cho tác nhân này.",
        ),
    )
