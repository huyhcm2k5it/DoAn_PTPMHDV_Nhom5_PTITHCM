# Identity Service

Owner: Hưng. Django/PostgreSQL; quản lý tài khoản, OTP, phiên đăng nhập, quyền nhân viên và JWT. Xem [OpenAPI](../../contracts/http/identity.openapi.json) và [event quyền truy cập](../../contracts/messages/identity-access.v1.schema.json).

## Chạy với database online

Hưng điền `env/hung.env` theo [mẫu chung](../../env/README.md), với `IDENTITY_DB_*` trỏ Aiven và `IDENTITY_DB_SSLMODE=require`. Compose nạp file này vào Identity; khi chạy service riêng cần nạp cùng biến từ file thật. `jwt_private.pem` chỉ nằm trên máy chạy Identity, không đưa vào Git. Tạo một cặp key bằng `python scripts/generate_keys.py generate`; chia sẻ **public key** cho Gateway và service xác minh JWT.

Dockerfile của service cài dependencies, chạy migration rồi mở API bằng Gunicorn trên cổng 8004–8006 tương ứng. Khi triển khai, nạp env thật vào container và chỉ cho Gateway truy cập API.

Chạy `python manage.py run_identity_worker` trong tiến trình riêng khi dùng RabbitMQ. `/health/live` kiểm tiến trình; `/health/ready` kiểm dependency, chưa xác nhận consumer khác đã cập nhật projection. `ALLOW_DEV_OTP` chỉ dành cho môi trường phát triển.

## Kiểm tra và bàn giao

Test code nằm trong `tests/`. Các service dùng cùng issuer, audience, public key, JWT `sub`, `actorType`, `tokenVersion`, capability và authorization lease theo [JWT specification](../../contracts/http/auth-jwt-specification.md). Khi thu hồi quyền, consumer phải cập nhật local projection trước khi chấp nhận thao tác được bảo vệ.

## OTP và nâng cấp hash mật khẩu

- Cài dependencies từ `requirements.txt` trước khi khởi động: Django có extra `argon2`. Hash mới dùng Argon2id; vẫn đọc hash PBKDF2 lịch sử. Xác thực đúng sẽ nâng cấp hash cũ bằng cập nhật có điều kiện, không tự tăng tokenVersion hay thu hồi phiên. Cấu hình theo [tài liệu Django](https://docs.djangoproject.com/en/dev/topics/auth/passwords/#using-argon2-with-django).
- Migration `0009_otp_resend_window` thêm `is_resend` và index cửa sổ gửi. Một lần gửi đầu không tính là resend; tối đa 3 resend trong `(now - 1 giờ, now]` cho mỗi phone/purpose, khoảng cách gửi tối thiểu 60 giây. Các đường đăng ký lại, resend và quên mật khẩu cùng khóa User và kiểm quota trong PostgreSQL. Dòng cũ được tính bảo thủ là resend trong giờ đầu sau nâng cấp; không xóa OTP còn nằm trong cửa sổ quota chỉ vì mã đã hết hiệu lực.
- IA-003 bắt buộc Idempotency-Key UUID. Retry giữ nguyên key/payload để nhận lại kết quả, kể cả kết quả lỗi đã lưu; sau khi sửa lỗi đầu vào, hết cooldown hoặc muốn thử gửi lại sau lỗi email, tạo một ý định với key mới. Replay không sinh mã hay gửi email lại. Không dùng key làm thông tin xác thực.
- Với purpose RESET và IA-007, `200 accepted` không chứng minh tài khoản tồn tại hoặc email đã gửi. Tài khoản không hợp lệ, cooldown, quota và lỗi email đều giữ phản hồi công khai giống nhau. REGISTER trả 409 cho cooldown hoặc tài khoản không thể kích hoạt, 429 RATE_LIMITED cho quota; không ghi OTP/email adapter exception vào log.
- Gửi email đang là thao tác đồng bộ trong transaction. Idempotency chống gửi lại sau khi kết quả đã commit; chưa bảo đảm exactly-once khi SMTP nhận thư nhưng tiến trình chết trước DB commit. Lỗi gửi đã báo về sẽ rollback OTP mới để giữ mã trước còn dùng được trong hạn của nó.

## Lệnh kiểm tra sau khi sửa

Từ thư mục gốc repo, cài dependency rồi chạy suite trên DB SQLite cô lập để kiểm nhanh:

```powershell
python -m pip install -r services/identity/requirements.txt
python tools/be/test_django.py identity --sqlite
python tools/be/test_django.py notification --sqlite
```

Kiểm migration/model từ thư mục service, không áp dụng migration lên DB chung bằng lệnh kiểm tra:

```powershell
python services/identity/manage.py makemigrations --check --dry-run
python services/notification/manage.py makemigrations --check --dry-run
```

SQLite bỏ qua test concurrency/recovery PostgreSQL. Để kiểm thật, cấu hình IDENTITY_DB_* hoặc NOTIFICATION_DB_* đến DB PostgreSQL cô lập có tên bắt đầu `umc_be_test_`, rồi chạy `python tools/be/test_django.py identity` hoặc `python tools/be/test_django.py notification`. Runner tạo và hủy test DB; tài khoản phải có quyền tạo test DB. Không dùng tên/credential DB demo hoặc DB chung cho bước này. Chỉ áp dụng migration triển khai sau khi các kiểm tra đã đạt.
