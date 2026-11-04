from django.urls import path
from app.api.view_health import health_ready, health_live

urlpatterns = [
    path("health/ready", health_ready, name="health_ready"),
    path("health/live", health_live, name="health_live"),
]