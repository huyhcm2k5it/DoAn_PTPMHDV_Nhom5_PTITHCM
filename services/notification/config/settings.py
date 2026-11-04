import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-insecure-notification-secret-key-latest")
DEBUG = os.getenv("DEBUG", "True").lower() == "true"

ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "rest_framework",
    "app.apps.NotificationAppConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# Kết nối PostgreSQL (notification_db)
DB_NAME = os.getenv("NOTIFICATION_DB_NAME")
if DB_NAME:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": DB_NAME,
            "USER": os.getenv("NOTIFICATION_DB_USER", "postgres"),
            "PASSWORD": os.getenv("NOTIFICATION_DB_PASSWORD", "postgres"),
            "HOST": os.getenv("NOTIFICATION_DB_HOST", "localhost"),
            "PORT": os.getenv("NOTIFICATION_DB_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "dev.sqlite3",
        }
    }

REST_FRAMEWORK = {
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"