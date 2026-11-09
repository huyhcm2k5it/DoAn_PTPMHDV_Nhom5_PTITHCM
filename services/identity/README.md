# Identity Service

Owner: Hưng. Django/PostgreSQL; quản lý tài khoản, OTP, phiên đăng nhập, quyền nhân viên và JWT. Xem [OpenAPI](../../contracts/http/identity.openapi.json) và [event quyền truy cập](../../contracts/messages/identity-access.v1.schema.json).

## Chạy local

Hưng điền `env/hung.env` theo [mẫu chung](../../env/README.md). Compose nạp file này vào Identity; chạy native cần export các biến tương ứng và đổi DB host thành địa chỉ truy cập từ máy. `jwt_private.pem` chỉ nằm trên máy chạy Identity, không đưa vào Git. Tạo cặp key bằng `python scripts/generate_keys.py generate`; chia sẻ **public key** cho Gateway và service xác minh JWT.

```powershell
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

Chạy `python manage.py run_identity_worker` trong tiến trình riêng khi dùng RabbitMQ. `/health/live` kiểm tiến trình; `/health/ready` kiểm dependency, chưa xác nhận consumer khác đã cập nhật projection. `ALLOW_DEV_OTP` chỉ dành cho môi trường phát triển.

## Kiểm tra và bàn giao

Test code nằm trong `tests/`. Các service dùng cùng issuer, audience, public key, JWT `sub`, `actorType`, `tokenVersion`, capability và authorization lease theo [JWT specification](../../contracts/http/auth-jwt-specification.md). Khi thu hồi quyền, consumer phải cập nhật local projection trước khi chấp nhận thao tác được bảo vệ.
