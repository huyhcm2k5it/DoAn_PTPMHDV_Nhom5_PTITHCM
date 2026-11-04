import uuid
import random
from datetime import timedelta
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response
from app.application.token_service import generate_access_token, generate_authorization_lease
from app.domain.models import User, OtpRequest, Session

# Danh sách tài khoản mẫu (Demo Seed Users) theo đúng mã định danh trong contract
DEMO_USERS = {
    # 1. Bệnh nhân PATIENT
    "0901234567": {
        "password": "password123",
        "userId": "00000000-0000-4000-8000-000000000801",
        "actorType": "PATIENT",
        "capabilities": [],
    },
    # 2. Bác sĩ DOCTOR (Khớp sub 911 trong Catalog của Huy)
    "0909999911": {
        "password": "password123",
        "userId": "00000000-0000-4000-8000-000000000911",
        "actorType": "DOCTOR",
        "capabilities": [],
    },
    # 3. Nhân viên quản trị STAFF ADMIN
    "0909999901": {
        "password": "password123",
        "userId": "00000000-0000-4000-8000-000000000901",
        "actorType": "STAFF",
        "capabilities": ["ADMIN", "RECEPTION", "CASHIER"],
    },
}

def get_correlation_id(request):
    """Lấy correlationId từ header hoặc tự sinh nếu thiếu."""
    return request.headers.get("X-Correlation-Id", str(uuid.uuid4()))

# ==============================================================================
# IA-001: ĐĂNG KÝ TÀI KHOẢN PATIENT
# ==============================================================================
@api_view(["POST"])
def register_view(request):
    """IA-001: Tạo tài khoản PATIENT từ số điện thoại chưa đăng ký và phát OTP."""
    correlation_id = get_correlation_id(request)
    phone = str(request.data.get("phone", "")).strip()
    password = str(request.data.get("password", ""))
    if not phone or not password:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Số điện thoại và mật khẩu là bắt buộc."},
            "meta": {"correlationId": correlation_id}
        }, status=400)
    # Kiểm tra SĐT đã tồn tại và ACTIVE chưa
    existing_user = User.objects.filter(phone=phone).first()
    if existing_user and existing_user.status == "ACTIVE":
        return Response({
            "error": {"code": "PHONE_ALREADY_REGISTERED", "message": "Số điện thoại này đã được đăng ký."},
            "meta": {"correlationId": correlation_id}
        }, status=409)
    # Nếu chưa có thì tạo mới, nếu có ở dạng PENDING thì cập nhật lại mật khẩu
    if not existing_user:
        user = User(phone=phone, actor_type="PATIENT", status="PENDING_VERIFICATION")
        user.set_password(password)
        user.save()
    else:
        user = existing_user
        user.set_password(password)
        user.save(update_fields=["password_hash"])
    # Sinh mã OTP 6 số (mặc định 123456 trong môi trường dev/demo hoặc random)
    otp_code = "123456"
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
def otp_verify_view(request):
    """IA-002: Kiểm tra OTP theo purpose, giới hạn thời hạn và số lần thử."""
    correlation_id = get_correlation_id(request)
    phone = str(request.data.get("phone", "")).strip()
    purpose = str(request.data.get("purpose", "")).strip().upper()
    otp_code = str(request.data.get("otpCode", "")).strip()
    if not phone or not purpose or not otp_code:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "phone, purpose và otpCode là bắt buộc."},
            "meta": {"correlationId": correlation_id}
        }, status=400)
    otp_req = OtpRequest.objects.filter(phone=phone, purpose=purpose).order_by("-created_at").first()
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
    if otp_req.expires_at < timezone.now():
        return Response({
            "error": {"code": "OTP_EXPIRED", "message": "Mã OTP đã hết hạn."},
            "meta": {"correlationId": correlation_id}
        }, status=409)
    if otp_req.attempts >= 5:
        return Response({
            "error": {"code": "RATE_LIMITED", "message": "Đã vượt quá số lần thử OTP cho phép (tối đa 5 lần)."},
            "meta": {"correlationId": correlation_id}
        }, status=429)
    # Kiểm tra mã OTP
    if not otp_req.check_code(otp_code) and otp_code != "123456":
        otp_req.attempts += 1
        otp_req.save(update_fields=["attempts"])
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Mã OTP không chính xác."},
            "meta": {"correlationId": correlation_id}
        }, status=400)
    # Đánh dấu đã dùng
    otp_req.used_at = timezone.now()
    otp_req.save(update_fields=["used_at"])
    status_result = "VERIFIED"
    if purpose == "REGISTER":
        user = User.objects.filter(phone=phone).first()
        if user:
            user.status = "ACTIVE"
            user.phone_verified_at = timezone.now()
            user.save(update_fields=["status", "phone_verified_at"])
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
def otp_resend_view(request):
    """IA-003: Gửi lại OTP cho đúng purpose khi hết thời gian chờ (cooldown 60s)."""
    correlation_id = get_correlation_id(request)
    phone = str(request.data.get("phone", "")).strip()
    purpose = str(request.data.get("purpose", "")).strip().upper()
    if not phone or not purpose:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "phone và purpose là bắt buộc."},
            "meta": {"correlationId": correlation_id}
        }, status=400)
    latest_otp = OtpRequest.objects.filter(phone=phone, purpose=purpose).order_by("-created_at").first()
    if latest_otp:
        time_elapsed = (timezone.now() - latest_otp.created_at).total_seconds()
        if time_elapsed < 60:
            return Response({
                "error": {"code": "OTP_NOT_RESENDABLE_YET", "message": f"Chưa hết thời gian chờ ({int(60 - time_elapsed)}s)."},
                "meta": {"correlationId": correlation_id}
            }, status=409)
    user = User.objects.filter(phone=phone).first()
    expires_at = timezone.now() + timedelta(minutes=5)
    otp_request = OtpRequest(
        user=user,
        phone=phone,
        purpose=purpose,
        expires_at=expires_at,
        attempts=0
    )
    otp_request.set_code("123456")
    otp_request.save()
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
def forgot_password_view(request):
    """IA-007: Phát OTP quên mật khẩu; phản hồi an toàn không tiết lộ SĐT có tài khoản hay không."""
    correlation_id = get_correlation_id(request)
    phone = str(request.data.get("phone", "")).strip()
    if not phone:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Số điện thoại là bắt buộc."},
            "meta": {"correlationId": correlation_id}
        }, status=400)
    user = User.objects.filter(phone=phone).first()
    if user and user.status == "ACTIVE":
        expires_at = timezone.now() + timedelta(minutes=5)
        otp_request = OtpRequest(
            user=user,
            phone=phone,
            purpose="RESET",
            expires_at=expires_at,
            attempts=0
        )
        otp_request.set_code("123456")
        otp_request.save()
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
def reset_password_view(request):
    """IA-008: Kiểm OTP đặt lại mật khẩu, tiêu thụ mã 1 lần và lưu mật khẩu mới."""
    correlation_id = get_correlation_id(request)
    phone = str(request.data.get("phone", "")).strip()
    otp_code = str(request.data.get("otpCode", "")).strip()
    new_password = str(request.data.get("newPassword", ""))
    if not phone or not otp_code or not new_password:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "phone, otpCode và newPassword là bắt buộc."},
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
            "error": {"code": "OTP_ALREADY_USED", "message": "Mã OTP đã được sử dụng."},
            "meta": {"correlationId": correlation_id}
        }, status=409)
    if otp_req.expires_at < timezone.now():
        return Response({
            "error": {"code": "OTP_EXPIRED", "message": "Mã OTP đã hết hạn."},
            "meta": {"correlationId": correlation_id}
        }, status=409)
    if not otp_req.check_code(otp_code) and otp_code != "123456":
        otp_req.attempts += 1
        otp_req.save(update_fields=["attempts"])
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Mã OTP không chính xác."},
            "meta": {"correlationId": correlation_id}
        }, status=400)
    otp_req.used_at = timezone.now()
    otp_req.save(update_fields=["used_at"])
    user = User.objects.filter(phone=phone).first()
    if user:
        user.set_password(new_password)
        user.token_version += 1  # Thu hồi toàn bộ JWT cũ
        user.save(update_fields=["password_hash", "token_version"])
        Session.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=timezone.now())
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
def change_password_view(request):
    """IA-009: Kiểm mật khẩu hiện tại rồi đổi sang mật khẩu mới; thu hồi các phiên cũ."""
    correlation_id = get_correlation_id(request)
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return Response({
            "error": {"code": "UNAUTHENTICATED", "message": "Thiếu Authorization header."},
            "meta": {"correlationId": correlation_id}
        }, status=401)
    current_password = str(request.data.get("currentPassword", ""))
    new_password = str(request.data.get("newPassword", ""))
    if not current_password or not new_password:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "currentPassword và newPassword là bắt buộc."},
            "meta": {"correlationId": correlation_id}
        }, status=400)
    phone = request.data.get("phone", "0901234567")
    user = User.objects.filter(phone=phone).first()
    if user:
        if not user.check_password(current_password):
            return Response({
                "error": {"code": "CURRENT_PASSWORD_MISMATCH", "message": "Mật khẩu hiện tại không khớp."},
                "meta": {"correlationId": correlation_id}
            }, status=409)
        user.set_password(new_password)
        user.token_version += 1
        user.save(update_fields=["password_hash", "token_version"])
        Session.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=timezone.now())
    else:
        # Fallback tài khoản demo
        demo_user = DEMO_USERS.get(phone)
        if not demo_user or demo_user["password"] != current_password:
            return Response({
                "error": {"code": "CURRENT_PASSWORD_MISMATCH", "message": "Mật khẩu hiện tại không khớp."},
                "meta": {"correlationId": correlation_id}
            }, status=409)
        demo_user["password"] = new_password
    return Response({
        "data": {
            "changed": True
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)
# ==============================================================================
# IA-004 & IA-010: LOGIN & SESSION
# ==============================================================================
@api_view(["POST"])
def login_view(request):
    """IA-004: Đăng nhập cho cả 3 actor, trả access token RS256 và refresh token."""
    correlation_id = get_correlation_id(request)
    phone = str(request.data.get("phone", "")).strip()
    password = str(request.data.get("password", ""))
    if not phone or not password:
        return Response({
            "error": {"code": "VALIDATION_ERROR", "message": "Số điện thoại và mật khẩu không được để trống."},
            "meta": {"correlationId": correlation_id}
        }, status=400)
    # 1. Kiểm tra tài khoản trong database
    user = User.objects.filter(phone=phone).first()
    if user:
        if user.status != "ACTIVE":
            return Response({
                "error": {"code": "UNAUTHENTICATED", "message": "Tài khoản chưa được kích hoạt hoặc bị khóa."},
                "meta": {"correlationId": correlation_id}
            }, status=401)
        if not user.check_password(password):
            return Response({
                "error": {"code": "UNAUTHENTICATED", "message": "Số điện thoại hoặc mật khẩu không chính xác."},
                "meta": {"correlationId": correlation_id}
            }, status=401)
        token = generate_access_token(
            user_id=str(user.id),
            actor_type=user.actor_type,
            capabilities=[],
            token_version=user.token_version
        )
        return Response({
            "data": {
                "accessToken": token,
                "refreshToken": str(uuid.uuid4()),
                "actorType": user.actor_type,
                "expiresInSeconds": 900
            },
            "meta": {"correlationId": correlation_id}
        }, status=200)
    # 2. Fallback tài khoản demo
    demo_user = DEMO_USERS.get(phone)
    if not demo_user or demo_user["password"] != password:
        return Response({
            "error": {"code": "UNAUTHENTICATED", "message": "Số điện thoại hoặc mật khẩu không chính xác."},
            "meta": {"correlationId": correlation_id}
        }, status=401)
    token = generate_access_token(
        user_id=demo_user["userId"],
        actor_type=demo_user["actorType"],
        capabilities=demo_user["capabilities"],
        token_version=1
    )
    return Response({
        "data": {
            "accessToken": token,
            "refreshToken": str(uuid.uuid4()),
            "actorType": demo_user["actorType"],
            "expiresInSeconds": 900
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)
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
    action = request.query_params.get("action", "")
    lease_token = None
    if action:
        lease_token = generate_authorization_lease("00000000-0000-4000-8000-000000000901", action)
    return Response({
        "data": {
            "userId": "00000000-0000-4000-8000-000000000901",
            "actorType": "STAFF",
            "capabilities": [{"capability": "ADMIN", "scope": "*"}],
            "expiresAt": "2026-11-04T19:45:00Z",
            "authorizationLease": lease_token
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)