from django.urls import path
from app.api.view_health import health_ready, health_live
from app.api.view_auth import (
    login_view, 
    session_view,
    register_view,
    otp_verify_view,
    otp_resend_view,
    forgot_password_view,
    reset_password_view,
    change_password_view,
    refresh_token_view,
    logout_view,
)
urlpatterns = [
    # Health checks
    path("health/ready", health_ready, name="health_ready"),
    path("health/live", health_live, name="health_live"),

    # IA-001..003: Đăng ký & Xác thực OTP
    path("api/v1/auth/register", register_view, name="auth_register"),
    path("api/v1/auth/otp/verify", otp_verify_view, name="auth_otp_verify"),
    path("api/v1/auth/otp/resend", otp_resend_view, name="auth_otp_resend"),

    # IA-004 & IA-010: Đăng nhập & Quản lý phiên
    path("api/v1/auth/login", login_view, name="auth_login"),
    path("api/v1/auth/session", session_view, name="auth_session"),

    # IA-007..009: Quên, Reset & Đổi mật khẩu
    path("api/v1/auth/password/forgot", forgot_password_view, name="auth_password_forgot"),
    path("api/v1/auth/password/reset", reset_password_view, name="auth_password_reset"),
    path("api/v1/auth/password", change_password_view, name="auth_password_change"),

    # IA-005: Refresh Token & Token Rotation
    path("api/v1/auth/token/refresh", refresh_token_view, name="auth_refresh"),
    # IA-011: Đăng xuất
    path("api/v1/auth/logout", logout_view, name="auth_logout"),
]