"""Xác thực Bearer JWT (RS256) do Identity phát hành cho Notification.
Gateway chỉ bảo đảm "có token hợp lệ"; service sở hữu dữ liệu vẫn phải tự xác
thực và giới hạn dữ liệu theo chủ sở hữu.
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
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Principal:
    user_id: str
    actor_type: str
    capabilities: tuple = ()
    token_version: int = 1
    claims: dict = field(default_factory=dict)


def _candidate_paths():
    explicit = os.getenv("JWT_PUBLIC_KEY_PATH")
    if explicit:
        return [Path(explicit)]
    service_root = Path(__file__).resolve().parents[2]
    return [
        service_root / "jwt_public.pem",
        service_root.parent.parent / "infra" / "certs" / "jwt_public.pem",
    ]


def _public_key():
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


def authenticate(request):
    header = request.headers.get("Authorization", "")
    parts = header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AuthError(401, "UNAUTHENTICATED", "Thiếu header Authorization: Bearer <token>.")

    try:
        claims = jwt.decode(
            parts[1],
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

    try:
        user_id = str(uuid.UUID(str(claims["sub"])))
    except (ValueError, TypeError):
        raise AuthError(401, "UNAUTHENTICATED", "Token thiếu hoặc sai định dạng sub.")

    capabilities = claims.get("capabilities") or []
    if not isinstance(capabilities, list):
        raise AuthError(401, "UNAUTHENTICATED", "Claim capabilities không hợp lệ.")

    return Principal(
        user_id=user_id,
        actor_type=str(claims.get("actorType") or ""),
        capabilities=tuple(str(item) for item in capabilities),
        token_version=int(claims.get("tokenVersion") or 1),
        claims=claims,
    )


def error_response(request, error):
    correlation_id = request.headers.get("X-Correlation-Id") or str(uuid.uuid4())
    return Response({
        "error": {"code": error.code, "message": error.message},
        "meta": {"correlationId": correlation_id},
    }, status=error.status)


def authenticated(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        try:
            request.principal = authenticate(request)
        except AuthError as error:
            return error_response(request, error)
        return view(request, *args, **kwargs)

    return wrapper
