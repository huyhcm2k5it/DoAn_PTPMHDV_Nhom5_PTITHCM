from django.urls import path
from app.api.view_health import health_ready, health_live
from app.api.view_auth import login_view, session_view

urlpatterns = [
    path("health/ready", health_ready, name="health_ready"),
    path("health/live", health_live, name="health_live"),

    path("api/v1/auth/login", login_view, name="auth_login"),
    path("api/v1/auth/session", session_view, name="auth_session"),
]