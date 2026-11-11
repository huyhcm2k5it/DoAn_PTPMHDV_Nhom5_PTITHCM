# Identity Service

Owner: Hưng. Django/PostgreSQL; quản lý tài khoản, OTP, phiên đăng nhập, quyền nhân viên và JWT. Xem [OpenAPI](../../contracts/http/identity.openapi.json) và [event quyền truy cập](../../contracts/messages/identity-access.v1.schema.json).

## Chạy với database online

Hưng điền `env/hung.env` theo [mẫu chung](../../env/README.md), với `IDENTITY_DB_*` trỏ Aiven và `IDENTITY_DB_SSLMODE=require`. Compose nạp file này vào Identity; khi chạy service riêng cần nạp cùng biến từ file thật. `jwt_private.pem` chỉ nằm trên máy chạy Identity, không đưa vào Git. Tạo một cặp key bằng `python scripts/generate_keys.py generate`; chia sẻ **public key** cho Gateway và service xác minh JWT.

Dockerfile của service cài dependencies, chạy migration rồi mở API bằng Gunicorn trên cổng 8004–8006 tương ứng. Khi triển khai, nạp env thật vào container và chỉ cho Gateway truy cập API.

Chạy `python manage.py run_identity_worker` trong tiến trình riêng khi dùng RabbitMQ. `/health/live` kiểm tiến trình; `/health/ready` kiểm dependency, chưa xác nhận consumer khác đã cập nhật projection. `ALLOW_DEV_OTP` chỉ dành cho môi trường phát triển.

## Kiểm tra và bàn giao

Test code nằm trong `tests/`. Các service dùng cùng issuer, audience, public key, JWT `sub`, `actorType`, `tokenVersion`, capability và authorization lease theo [JWT specification](../../contracts/http/auth-jwt-specification.md). Khi thu hồi quyền, consumer phải cập nhật local projection trước khi chấp nhận thao tác được bảo vệ.
