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
from app.api.view_dev import dev_otp_inbox_view
from app.api import view_admin
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
    path("api/v1/auth/refresh", refresh_token_view, name="auth_refresh"),
    # IA-006: Đăng xuất
    path("api/v1/auth/logout", logout_view, name="auth_logout"),

     # IA-011: STAFF[ADMIN] xem danh sách nhân viên và quyền hiện có
    path("api/v1/admin/staff", view_admin.staff_list_view, name="admin_staff_list"),
    # IA-012: STAFF[ADMIN] cấp/thu hồi capability
    path("api/v1/admin/staff/<uuid:staff_id>/roles", view_admin.staff_roles_view, name="admin_staff_roles"),
    # IA-013: STAFF[ADMIN] tra cứu nhật ký kiểm toán
    path("api/v1/admin/audit", view_admin.audit_list_view, name="admin_audit_list"),

    # DEV ONLY: hộp thư SMS giả lập, bị tắt khi ALLOW_DEV_OTP=false
    path("api/v1/dev/otp-inbox", dev_otp_inbox_view, name="dev_otp_inbox"),
]