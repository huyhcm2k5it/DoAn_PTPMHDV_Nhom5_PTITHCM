import uuid
from rest_framework.decorators import api_view
from rest_framework.response import Response
from app.application.token_service import generate_access_token, generate_authorization_lease

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

@api_view(["POST"])
def login_view(request):
    """IA-004: Đăng nhập cho cả 3 actor, trả access token RS256 và refresh token."""
    correlation_id = get_correlation_id(request)
    phone = request.data.get("phone", "").strip()
    password = request.data.get("password", "")

    # Kiểm tra thiếu dữ liệu
    if not phone or not password:
        return Response({
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Số điện thoại và mật khẩu không được để trống."
            },
            "meta": {"correlationId": correlation_id}
        }, status=400)

    # Xác thực tài khoản
    user = DEMO_USERS.get(phone)
    if not user or user["password"] != password:
        return Response({
            "error": {
                "code": "UNAUTHENTICATED",
                "message": "Số điện thoại hoặc mật khẩu không chính xác."
            },
            "meta": {"correlationId": correlation_id}
        }, status=401)

    # Sinh Access Token RS256 chuẩn hợp đồng
    token = generate_access_token(
        user_id=user["userId"],
        actor_type=user["actorType"],
        capabilities=user["capabilities"],
        token_version=1
    )

    return Response({
        "data": {
            "accessToken": token,
            "refreshToken": str(uuid.uuid4()),
            "actorType": user["actorType"],
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
        # Giả lập cấp lease cho thao tác nhạy cảm (VD: CA-004)
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