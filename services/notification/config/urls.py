from django.urls import path
from app.api.view_health import health_ready, health_live
from app.api.view_notifications import notifications_list_view, mark_read_view

urlpatterns = [
    path("health/ready", health_ready, name="health_ready"),
    path("health/live", health_live, name="health_live"),

    # NO-001: danh sách thông báo của tài khoản hiện tại
    path("api/v1/notifications", notifications_list_view, name="notifications-list"),
    # NO-002: đánh dấu một thông báo đã đọc
    path("api/v1/notifications/<uuid:notification_id>/read", mark_read_view, name="notifications-read"),
]