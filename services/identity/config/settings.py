import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-insecure-identity-secret-key-latest")
DEBUG = os.getenv("DEBUG", "False").lower() == "true"
# Hộp thư SMS giả lập cho demo local. Bật riêng, độc lập với DEBUG,
# để demo có thể chạy DEBUG=False mà vẫn lấy được OTP.
ALLOW_DEV_OTP = os.getenv("ALLOW_DEV_OTP", "false").lower() == "true"


ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "rest_framework",
    "app.apps.IdentityAppConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# Kết nối PostgreSQL chuẩn psycopg 3
DB_NAME = os.getenv("IDENTITY_DB_NAME")
if DB_NAME:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": DB_NAME,
            "USER": os.getenv("IDENTITY_DB_USER", "postgres"),
            "PASSWORD": os.getenv("IDENTITY_DB_PASSWORD", "postgres"),
            "HOST": os.getenv("IDENTITY_DB_HOST", "localhost"),
            "PORT": os.getenv("IDENTITY_DB_PORT", "5432"),
            "OPTIONS": {"sslmode": os.getenv("IDENTITY_DB_SSLMODE", "prefer")},
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
