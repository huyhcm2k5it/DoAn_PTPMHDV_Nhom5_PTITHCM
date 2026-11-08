import uuid
import hashlib
import logging
import re
import secrets
from datetime import datetime, timezone as dt_tz, timedelta
from django.utils import timezone
from django.db import transaction
from rest_framework.decorators import api_view
from rest_framework.response import Response
from app.application.token_service import generate_access_token, verify_access_token, generate_authorization_lease
from app.api.audit import record_audit
from app.domain.models import User, OtpRequest, Session, StaffCapability
from app.infrastructure.sms import get_sms_sender

logger = logging.getLogger(__name__)

PHONE_PATTERN = re.compile(r"^[0-9]{9,11}$")
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15

def get_correlation_id(request):
    """Lấy correlationId từ header hoặc tự sinh nếu thiếu."""
    return request.headers.get("X-Correlation-Id", str(uuid.uuid4()))

def normalize_phone(raw):
    """Chuẩn hoá số điện thoại; trả None nếu không hợp lệ.

    Cột phone là varchar(20) nên phải chặn trước khi ghi, nếu không Postgres
    ném DataError và API trả 500 thay vì 400.
    """
    phone = str(raw or "").strip().replace(" ", "")
    if not PHONE_PATTERN.match(phone):
        return None
    return phone

def validate_password(password):
    """Trả thông báo lỗi hoặc None nếu mật khẩu hợp lệ."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Mật khẩu phải có ít nhất {MIN_PASSWORD_LENGTH} ký tự."
    if len(password) > MAX_PASSWORD_LENGTH:
        return f"Mật khẩu tối đa {MAX_PASSWORD_LENGTH} ký tự."
    return None

def send_otp(phone, code, purpose, correlation_id):
    """Gửi OTP qua kênh đã cấu hình; trả response 503 nếu kênh lỗi."""
    try:
        get_sms_sender().send_otp(phone, code, purpose)
        return None
    except Exception:
        logger.error("SMS adapter unavailable; correlation=%s", correlation_id)
        return Response({
            "error": {
                "code": "SMS_UNAVAILABLE",
                "message": "Chưa gửi được mã xác thực, vui lòng thử lại sau."
            },
            "meta": {"correlationId": correlation_id}
        }, status=503)

# ==============================================================================
# IA-001: ĐĂNG KÝ TÀI KHOẢN PATIENT
# ==============================================================================
@api_view(["POST"])
@transaction.atomic
def register_view(request):
    """IA-001: Tạo tài khoản PATIENT từ số điện thoại chưa đăng ký và phát OTP."""
    correlation_id = get_correlation_id(request)
    phone = normalize_phone(request.data.get("phone"))
    password = str(request.data.get("password", ""))
    if not phone or not password:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Số điện thoại không hợp lệ hoặc thiếu mật khẩu."},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    password_error = validate_password(password)
    if password_error:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": password_error},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    # Kiểm tra SĐT đã tồn tại chưa
    existing_user = User.objects.select_for_update().filter(phone=phone).first()
    if existing_user and (existing_user.status != "PENDING_VERIFICATION" or existing_user.actor_type != "PATIENT"):
        return Response({
            "error": {"code": "PHONE_ALREADY_REGISTERED", "message": "Số điện thoại này đã được đăng ký."},
            "meta": {"correlationId": correlation_id}
        }, status=409)

    # Nếu chưa có thì tạo mới, nếu có ở dạng PENDING thì chỉ cập nhật lại mật khẩu
    if not existing_user:
        user = User(phone=phone, actor_type="PATIENT", status="PENDING_VERIFICATION")
        user.set_password(password)
        user.save()
        from app.application.access_events import publish_access
        publish_access(user)
    else:
        user = existing_user
        user.set_password(password)
        user.save(update_fields=["password_hash"])

    # Sinh mã OTP 6 số ngẫu nhiên an toàn
    otp_code = f"{secrets.randbelow(900000) + 100000:06d}"
    expires_at = timezone.now() + timedelta(minutes=5)
    otp_request = OtpRequest(
        user=user,
        phone=phone,
        purpose="REGISTER",
        expires_at=expires_at,
        attempts=0
    )
    otp_request.set_code(otp_code)
    otp_request.save()

    send_error = send_otp(phone, otp_code, "REGISTER", correlation_id)
    if send_error:
        return send_error

    return Response({
        "data": {
            "userId": str(user.id),
            "status": user.status,
            "otpExpiresAt": expires_at.isoformat()
        },
        "meta": {"correlationId": correlation_id}
    }, status=201)

# ==============================================================================
# IA-002: XÁC THỰC OTP
# ==============================================================================
@api_view(["POST"])
@transaction.atomic
def otp_verify_view(request):
    """IA-002: Kiểm tra OTP theo purpose, giới hạn thời hạn và số lần thử."""
    correlation_id = get_correlation_id(request)
    phone = normalize_phone(request.data.get("phone"))
    purpose = str(request.data.get("purpose", "")).strip().upper()
    otp_code = str(request.data.get("otpCode", "")).strip()

    if not phone or not purpose or not otp_code:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "phone không hợp lệ, purpose và otpCode là bắt buộc."},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    otp_req = OtpRequest.objects.select_for_update().filter(phone=phone, purpose=purpose).order_by("-created_at").first()
    if not otp_req:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Không tìm thấy yêu cầu OTP cho số điện thoại này."},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    if otp_req.used_at is not None:
        return Response({
            "error": {"code": "OTP_ALREADY_USED", "message": "Mã OTP này đã được sử dụng."},
            "meta": {"correlationId": correlation_id}
        }, status=409)

    if otp_req.expires_at <= timezone.now():
        return Response({
            "error": {"code": "OTP_EXPIRED", "message": "Mã OTP đã hết hạn."},
            "meta": {"correlationId": correlation_id}
        }, status=409)

    if otp_req.attempts >= 5:
        return Response({
            "error": {"code": "RATE_LIMITED", "message": "Đã vượt quá số lần thử OTP cho phép (tối đa 5 lần)."},
            "meta": {"correlationId": correlation_id}
        }, status=429)

    # Kiểm tra mã OTP chặt chẽ theo hash trong DB
    if not otp_req.check_code(otp_code):
        otp_req.attempts += 1
        otp_req.save(update_fields=["attempts"])
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Mã OTP không chính xác."},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    if purpose == "REGISTER":
        account = User.objects.select_for_update().filter(phone=phone).first()
        if not account or account.actor_type != "PATIENT" or account.status != "PENDING_VERIFICATION":
            return Response({"error": {"code": "ACCOUNT_NOT_ACTIVATABLE", "message": "Account cannot be activated."}}, status=409)

    # Đánh dấu đã dùng
    otp_req.used_at = timezone.now()
    otp_req.save(update_fields=["used_at"])
    record_audit(
        "AUTH_OTP_VERIFIED",
        correlation_id,
        actor_user_id=otp_req.user.id if otp_req.user else None,
        detail={"purpose": purpose},
    )

    status_result = "VERIFIED"
    if purpose == "REGISTER":
        user = User.objects.select_for_update().filter(phone=phone).first()
        if user:
            user.status = "ACTIVE"
            user.phone_verified_at = timezone.now()
            user.save(update_fields=["status", "phone_verified_at"])
            from app.application.access_events import publish_access
            publish_access(user)
            status_result = user.status

    return Response({
        "data": {
            "verified": True,
            "status": status_result
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)

# ==============================================================================
# IA-003: GỬI LẠI OTP
# ==============================================================================
@api_view(["POST"])
@transaction.atomic
def otp_resend_view(request):
    """IA-003: Gửi lại OTP cho đúng purpose khi hết thời gian chờ (cooldown 60s)."""
    correlation_id = get_correlation_id(request)
    phone = normalize_phone(request.data.get("phone"))
    purpose = str(request.data.get("purpose", "")).strip().upper()

    if not phone or not purpose:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "phone không hợp lệ hoặc thiếu purpose."},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    latest_otp = OtpRequest.objects.select_for_update().filter(phone=phone, purpose=purpose).order_by("-created_at").first()
    if latest_otp:
        time_elapsed = (timezone.now() - latest_otp.created_at).total_seconds()
        if time_elapsed < 60:
            return Response({
                "error": {"code": "OTP_NOT_RESENDABLE_YET", "message": f"Chưa hết thời gian chờ ({int(60 - time_elapsed)}s)."},
                "meta": {"correlationId": correlation_id}
            }, status=409)

    user = User.objects.select_for_update().filter(phone=phone).first()
    if purpose == "REGISTER" and (not user or user.actor_type != "PATIENT" or user.status != "PENDING_VERIFICATION"):
        return Response({"error": {"code": "ACCOUNT_NOT_ACTIVATABLE", "message": "Account cannot be activated."}}, status=409)
    otp_code = f"{secrets.randbelow(900000) + 100000:06d}"
    expires_at = timezone.now() + timedelta(minutes=5)
    otp_request = OtpRequest(
        user=user,
        phone=phone,
        purpose=purpose,
        expires_at=expires_at,
        attempts=0
    )
    otp_request.set_code(otp_code)
    otp_request.save()

    send_error = send_otp(phone, otp_code, purpose, correlation_id)
    if send_error:
        return send_error

    return Response({
        "data": {
            "accepted": True,
            "retryAfterSeconds": 60
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)

# ==============================================================================
# IA-007: YÊU CẦU QUÊN MẬT KHẨU
# ==============================================================================
@api_view(["POST"])
@transaction.atomic
def forgot_password_view(request):
    """IA-007: Phát OTP quên mật khẩu; phản hồi an toàn không tiết lộ SĐT có tài khoản hay không."""
    correlation_id = get_correlation_id(request)
    phone = normalize_phone(request.data.get("phone"))
    if not phone:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Số điện thoại không hợp lệ."},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    user = User.objects.select_for_update().filter(phone=phone).first()
    if user and user.status == "ACTIVE":
        otp_code = f"{secrets.randbelow(900000) + 100000:06d}"
        expires_at = timezone.now() + timedelta(minutes=5)
        otp_request = OtpRequest(
            user=user,
            phone=phone,
            purpose="RESET",
            expires_at=expires_at,
            attempts=0
        )
        otp_request.set_code(otp_code)
        otp_request.save()
        # Kênh giao lỗi không được làm lộ việc số này có tài khoản hay không
        if send_otp(phone, otp_code, "RESET", correlation_id) is not None:
            logger.warning("Không gửi được OTP RESET nhưng vẫn trả accepted để chống enumeration")

    # Luôn trả về 200 accepted theo chuẩn bảo mật chống enumeration
    return Response({
        "data": {
            "accepted": True,
            "retryAfterSeconds": 60
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)

# ==============================================================================
# IA-008: ĐẶT LẠI MẬT KHẨU BẰNG OTP
# ==============================================================================
@api_view(["POST"])
@transaction.atomic
def reset_password_view(request):
    """IA-008: Kiểm OTP đặt lại mật khẩu, tiêu thụ mã 1 lần và lưu mật khẩu mới."""
    correlation_id = get_correlation_id(request)
    phone = normalize_phone(request.data.get("phone"))
    otp_code = str(request.data.get("otpCode", "")).strip()
    new_password = str(request.data.get("newPassword", ""))

    if not phone or not otp_code or not new_password:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "phone không hợp lệ, otpCode và newPassword là bắt buộc."},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    password_error = validate_password(new_password)
    if password_error:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": password_error},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    otp_req = OtpRequest.objects.filter(phone=phone, purpose="RESET").order_by("-created_at").first()
    if not otp_req:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Không tìm thấy yêu cầu đặt lại mật khẩu."},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    if otp_req.used_at is not None:
        return Response({
            "error": {"code": "OTP_ALREADY_USED", "message": "Mã OTP này đã được sử dụng."},
            "meta": {"correlationId": correlation_id}
        }, status=409)

    if otp_req.expires_at <= timezone.now():
        return Response({
            "error": {"code": "OTP_EXPIRED", "message": "Mã OTP đã hết hạn."},
            "meta": {"correlationId": correlation_id}
        }, status=409)

    if otp_req.attempts >= 5:
        return Response({
            "error": {"code": "RATE_LIMITED", "message": "Đã vượt quá số lần thử OTP cho phép (tối đa 5 lần)."},
            "meta": {"correlationId": correlation_id}
        }, status=429)

    if not otp_req.check_code(otp_code):
        otp_req.attempts += 1
        otp_req.save(update_fields=["attempts"])
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Mã OTP không chính xác."},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    otp_req.used_at = timezone.now()
    otp_req.save(update_fields=["used_at"])

    user = User.objects.select_for_update().filter(phone=phone).first()
    if user:
        user.set_password(new_password)
        user.token_version += 1  # Thu hồi toàn bộ JWT cũ
        user.failed_login_attempts = 0
        user.locked_until = None
        user.save(update_fields=["password_hash", "token_version", "failed_login_attempts", "locked_until"])
        from app.application.access_events import publish_access
        publish_access(user)
        Session.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=timezone.now())
        record_audit(
            "AUTH_PASSWORD_RESET",
            correlation_id,
            actor_user_id=user.id,
            detail={"via": "OTP"},
        )

    return Response({
        "data": {
            "changed": True
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)

# ==============================================================================
# IA-009: ĐỔI MẬT KHẨU KHI ĐÃ ĐĂNG NHẬP
# ==============================================================================
@api_view(["PUT"])
@transaction.atomic
@transaction.atomic
def change_password_view(request):
    """IA-009: Kiểm mật khẩu hiện tại rồi đổi sang mật khẩu mới; thu hồi các phiên cũ."""
    correlation_id = get_correlation_id(request)
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return Response({
            "error": {"code": "UNAUTHENTICATED", "message": "Thiếu Authorization header."},
            "meta": {"correlationId": correlation_id}
        }, status=401)

    token = auth_header[7:].strip()
    try:
        payload = verify_access_token(token)
    except Exception as e:
        return Response({
            "error": {"code": "UNAUTHENTICATED", "message": f"Token không hợp lệ hoặc đã hết hạn: {str(e)}"},
            "meta": {"correlationId": correlation_id}
        }, status=401)

    sub = payload.get("sub")
    token_version = payload.get("tokenVersion", 1)

    current_password = str(request.data.get("currentPassword", ""))
    new_password = str(request.data.get("newPassword", ""))
    if not current_password or not new_password:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "currentPassword và newPassword là bắt buộc."},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    password_error = validate_password(new_password)
    if password_error:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": password_error},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    user = User.objects.filter(id=sub).first()
    if not user or user.status != "ACTIVE":
        return Response({
            "error": {"code": "FORBIDDEN", "message": "Tài khoản không tồn tại hoặc đã bị khóa."},
            "meta": {"correlationId": correlation_id}
        }, status=403)

    if user.token_version != token_version:
        return Response({
            "error": {"code": "UNAUTHENTICATED", "message": "Phiên làm việc đã bị thu hồi do thay đổi trước đó."},
            "meta": {"correlationId": correlation_id}
        }, status=401)

    if not user.check_password(current_password):
        return Response({
            "error": {"code": "CURRENT_PASSWORD_MISMATCH", "message": "Mật khẩu hiện tại không khớp."},
            "meta": {"correlationId": correlation_id}
        }, status=409)

    user.set_password(new_password)
    user.token_version += 1
    user.save(update_fields=["password_hash", "token_version"])
    from app.application.access_events import publish_access
    publish_access(user)
    Session.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=timezone.now())
    record_audit(
        "AUTH_PASSWORD_CHANGED",
        correlation_id,
        actor_user_id=user.id,
        detail={"via": "current_password"},
    )

    return Response({
        "data": {
            "changed": True
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)

# ==============================================================================
# IA-004: LOGIN
# ==============================================================================
@api_view(["POST"])
@transaction.atomic
def login_view(request):
    """IA-004: Đăng nhập cho cả 3 actor, trả access token RS256 và refresh token hợp lệ lưu DB."""
    correlation_id = get_correlation_id(request)
    phone = normalize_phone(request.data.get("phone"))
    password = str(request.data.get("password", ""))

    if not phone or not password:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Số điện thoại không hợp lệ hoặc mật khẩu trống."},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    user = User.objects.select_for_update().filter(phone=phone).first()
    if not user:
        return Response({
            "error": {"code": "UNAUTHENTICATED", "message": "Số điện thoại hoặc mật khẩu không chính xác."},
            "meta": {"correlationId": correlation_id}
        }, status=401)

    now = timezone.now()
    if user.locked_until and user.locked_until > now:
        return Response({
            "error": {
                "code": "ACCOUNT_LOCKED",
                "message": "Tài khoản tạm khoá do đăng nhập sai nhiều lần, vui lòng thử lại sau."
            },
            "meta": {"correlationId": correlation_id}
        }, status=429)

    if user.status != "ACTIVE":
        return Response({
            "error": {"code": "UNAUTHENTICATED", "message": "Tài khoản chưa được kích hoạt hoặc bị khóa."},
            "meta": {"correlationId": correlation_id}
        }, status=401)

    if not user.check_password(password):
        attempts = user.failed_login_attempts + 1
        update_fields = ["failed_login_attempts"]
        if attempts >= MAX_FAILED_LOGINS:
            user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            user.failed_login_attempts = 0
            update_fields.append("locked_until")
        else:
            user.failed_login_attempts = attempts
        user.save(update_fields=update_fields)
        record_audit(
            "AUTH_LOGIN_FAILED",
            correlation_id,
            actor_user_id=user.id,
            detail={"failedAttempts": attempts, "locked": attempts >= MAX_FAILED_LOGINS},
        )
        return Response({
            "error": {"code": "UNAUTHENTICATED", "message": "Số điện thoại hoặc mật khẩu không chính xác."},
            "meta": {"correlationId": correlation_id}
        }, status=401)

    # Đăng nhập đúng thì xoá bộ đếm sai và mở khoá
    if user.failed_login_attempts or user.locked_until:
        user.failed_login_attempts = 0
        user.locked_until = None
        user.save(update_fields=["failed_login_attempts", "locked_until"])

    # Lấy capabilities thực tế từ DB
    capabilities = list(StaffCapability.objects.filter(user=user, enabled=True).values_list("capability", flat=True))

    token = generate_access_token(
        user_id=str(user.id),
        actor_type=user.actor_type,
        capabilities=capabilities,
        token_version=user.token_version
    )

    # Sinh và lưu Session thực tế vào DB để có thể rotate được
    raw_refresh_token = secrets.token_urlsafe(48)
    refresh_hash = hashlib.sha256(raw_refresh_token.encode("utf-8")).hexdigest()
    Session.objects.create(
        user=user,
        refresh_hash=refresh_hash,
        expires_at=timezone.now() + timedelta(days=7)
    )

    record_audit(
        "AUTH_LOGIN_SUCCEEDED",
        correlation_id,
        actor_user_id=user.id,
        detail={"actorType": user.actor_type},
    )

    return Response({
        "data": {
            "accessToken": token,
            "refreshToken": raw_refresh_token,
            "actorType": user.actor_type,
            "expiresInSeconds": 900
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)

# ==============================================================================
# IA-010: SESSION & AUTHORIZATION LEASE
# ==============================================================================
@api_view(["GET"])
def session_view(request):
    """IA-010: Tra cứu phiên, quyền và cấp authorization lease tối đa 30s."""
    correlation_id = get_correlation_id(request)
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return Response({
            "error": {"code": "UNAUTHENTICATED", "message": "Thiếu Authorization header."},
            "meta": {"correlationId": correlation_id}
        }, status=401)

    token = auth_header[7:].strip()
    try:
        payload = verify_access_token(token)
    except Exception as e:
        return Response({
            "error": {"code": "UNAUTHENTICATED", "message": f"Token không hợp lệ hoặc đã hết hạn: {str(e)}"},
            "meta": {"correlationId": correlation_id}
        }, status=401)

    sub = payload.get("sub")
    token_version = payload.get("tokenVersion", 1)

    user = User.objects.filter(id=sub).first()
    if not user or user.status != "ACTIVE":
        return Response({
            "error": {"code": "FORBIDDEN", "message": "Tài khoản không tồn tại hoặc đã bị khóa."},
            "meta": {"correlationId": correlation_id}
        }, status=403)

    if user.token_version != token_version:
        return Response({
            "error": {"code": "UNAUTHENTICATED", "message": "Phiên làm việc đã bị thu hồi do đổi mật khẩu."},
            "meta": {"correlationId": correlation_id}
        }, status=401)

    capabilities_qs = StaffCapability.objects.filter(user=user, enabled=True)
    capabilities_data = [
        {"capability": cap.capability, "scopeKey": cap.scope_key, "enabled": cap.enabled}
        for cap in capabilities_qs
    ]

    action = request.query_params.get("action", "")
    lease_token = None
    if action:
        from app.application.lease_policy import can_issue_lease
        capabilities = set(capabilities_qs.values_list("capability", flat=True))
        if not can_issue_lease(user.actor_type, capabilities, action):
            return Response({"error": {"code": "FORBIDDEN", "message": "Action is outside account scope."}}, status=403)
        lease_token = generate_authorization_lease(str(user.id), action, user.token_version)

    exp = payload.get("exp")
    expires_at_iso = datetime.fromtimestamp(exp, tz=dt_tz.utc).isoformat() if exp else None

    return Response({
        "data": {
            "userId": str(user.id),
            "actorType": user.actor_type,
            "capabilities": capabilities_data,
            "expiresAt": expires_at_iso,
            "authorizationLease": lease_token
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)

# ==============================================================================
# IA-005: REFRESH TOKEN & TOKEN ROTATION
# ==============================================================================
@api_view(["POST"])
def refresh_token_view(request):
    """IA-005: Refresh Access Token & Xoay vòng Refresh Token (Token Rotation) nguyên tử"""
    correlation_id = get_correlation_id(request)
    refresh_token = str(request.data.get("refreshToken", "")).strip()
    if not refresh_token:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "refreshToken là bắt buộc."},
            "meta": {"correlationId": correlation_id}
        }, status=400)

    token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()

    with transaction.atomic():
        session = Session.objects.select_for_update().filter(refresh_hash=token_hash).first()
        if not session or session.revoked_at or session.expires_at < timezone.now():
            return Response({
                "error": {"code": "AUTH_INVALID_TOKEN", "message": "Refresh token không hợp lệ, đã hết hạn hoặc bị thu hồi."},
                "meta": {"correlationId": correlation_id}
            }, status=401)

        user = session.user
        if user.status != "ACTIVE":
            return Response({
                "error": {"code": "AUTH_USER_BLOCKED", "message": "Tài khoản không hoạt động hoặc đã bị khóa."},
                "meta": {"correlationId": correlation_id}
            }, status=403)

        # Thu hồi token cũ và sinh token mới
        session.revoked_at = timezone.now()
        session.save(update_fields=["revoked_at"])

        new_refresh_token = secrets.token_urlsafe(48)
        new_token_hash = hashlib.sha256(new_refresh_token.encode()).hexdigest()
        expires_at = timezone.now() + timedelta(days=7)

        Session.objects.create(
            user=user,
            refresh_hash=new_token_hash,
            expires_at=expires_at
        )

        capabilities = list(StaffCapability.objects.filter(user=user, enabled=True).values_list("capability", flat=True))
        access_token = generate_access_token(
            user_id=str(user.id),
            actor_type=user.actor_type,
            capabilities=capabilities,
            token_version=user.token_version
        )

    return Response({
        "data": {
            "accessToken": access_token,
            "refreshToken": new_refresh_token,
            "expiresInSeconds": 900
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)

# ==============================================================================
# IA-006: LOGOUT - THU HỒI PHIÊN
# ==============================================================================
@api_view(["POST"])
@transaction.atomic
def logout_view(request):
    """IA-006: Logout - Thu hồi phiên refresh token"""
    correlation_id = get_correlation_id(request)
    refresh_token = str(request.data.get("refreshToken", "")).strip()

    from app.api.authz import load_principal
    user, _, error = load_principal(request)
    if error:
        return error
    token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
    session = Session.objects.select_for_update().filter(refresh_hash=token_hash, user=user, revoked_at__isnull=True, expires_at__gt=timezone.now()).first()
    if not session:
        return Response({"error": {"code": "AUTH_INVALID_TOKEN", "message": "Refresh session is invalid."}}, status=401)
    session.revoked_at = timezone.now()
    session.save(update_fields=["revoked_at"])

    return Response({
        "data": {
            "revoked": True
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)
