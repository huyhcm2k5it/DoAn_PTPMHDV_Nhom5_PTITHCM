# Cấu hình online theo owner

Nhóm dùng chung MongoDB Atlas, Neon PostgreSQL, Aiven PostgreSQL, CloudAMQP và một Redis online. Mỗi người giữ đúng một file thật: `env/quan.env`, `env/huy.env`, `env/hung.env`. Tạo từ file `.env.example` tương ứng, thay toàn bộ `REPLACE`, rồi chia sẻ credential qua kênh riêng. Git chỉ lưu file mẫu.

| Owner | File | Phạm vi |
| --- | --- | --- |
| Quân | `quan.env` | Patient, Appointment, Pharmacy; ba MongoDB URI, Redis và RabbitMQ chung |
| Huy | `huy.env` | Ba Neon PostgreSQL URL cho Catalog, Clinical, Diagnostic |
| Hưng | `hung.env` | Ba database Identity, Billing, Notification trên Aiven, cấu hình JWT và SMTP |

## Cổng và địa chỉ

| Thành phần | Cổng ứng dụng | Owner |
| --- | ---: | --- |
| Gateway | 8080 | Quân |
| Patient, Appointment, Pharmacy | 8001–8003 | Quân |
| Identity, Billing, Notification | 8004–8006 | Hưng |
| Catalog, Clinical, Diagnostic | 8007–8009 | Huy |

Các cổng ứng dụng là hợp đồng với Gateway và healthcheck; đổi cổng phải đổi cả cấu hình định tuyến. Cổng database/broker do nhà cung cấp online cấp, không dùng cổng container làm địa chỉ kết nối. CloudAMQP TLS thường dùng `5671`; lấy host, vhost và cổng thực tế từ dashboard của broker.

## Giá trị cần điền

1. **Quân:** mỗi `*_MONGO_URI` phải trỏ đúng database của service sở hữu. `UMC_AMQP_URL=amqps://USER:PASSWORD@HOST:PORT/VHOST` là URL broker duy nhất của nhóm. Các biến `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_VHOST`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD` phải khớp URL đó vì service Hưng còn đọc dạng tách trường. `UMC_REDIS_URL=rediss://USER:PASSWORD@HOST:PORT/0` là URL Redis chung; Compose truyền nó cho Appointment và cả ba service Huy.
2. **Huy:** `CATALOG_DATABASE_URL`, `CLINICAL_DATABASE_URL`, `DIAGNOSTIC_DATABASE_URL` trỏ ba database Neon riêng, có `sslmode=require`. Worker Huy nhận RabbitMQ từ `UMC_AMQP_URL`; ba API Huy nhận Redis từ `UMC_REDIS_URL`, cả hai do Quân quản lý.
3. **Hưng:** giữ các bộ `IDENTITY_DB_*`, `BILLING_DB_*`, `NOTIFICATION_DB_*` của Aiven với `SSLMODE=require` và giữ `DJANGO_SECRET_KEY`. Trong `env/hung.env` trên máy chạy stack, bỏ nhóm `SMS_*` và điền các dòng sau bằng cấu hình SMTP của nhóm.

   ```dotenv
   EMAIL_BACKEND=smtp
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=REPLACE_SMTP_USER
   SMTP_PASSWORD=REPLACE_SMTP_PASSWORD
   SMTP_FROM_EMAIL=REPLACE_SMTP_FROM_EMAIL
   ALLOW_DEV_OTP=false
   ```

   Compose đọc `env/hung.env` cho cả API Identity và worker. Trên máy Identity, đặt private PEM khớp public key trên `develop` tại `services/identity/jwt_private.pem`. Compose mount file này ở chế độ chỉ đọc. Từ repo gốc chạy `node tools/quan/prepare-gateway-key.js --verify-identity` trên máy có private PEM. Lệnh kiểm cặp khóa trước khi tạo JWKS. Gateway chỉ cần public PEM và JWKS đã xác minh. Dùng issuer `umc-care-identity` và audience `umc-care-services`.

Mật khẩu nằm trong URI phải được percent-encode (`@` → `%40`, `/` → `%2F`). Base64 không mã hóa private key. Không commit file thật, DSN có mật khẩu, token, khóa riêng hoặc output của `docker compose config`.

## Mapping khi chạy riêng backend Huy

| Tiến trình | Biến tiến trình đọc | Nguồn giá trị |
| --- | --- | --- |
| Catalog, Clinical, Diagnostic (API, worker, migrate) | `DATABASE_URL` | Lần lượt `CATALOG_DATABASE_URL`, `CLINICAL_DATABASE_URL`, `DIAGNOSTIC_DATABASE_URL` từ `huy.env` |
| Catalog, Clinical, Diagnostic API | `LISTEN_ADDR` | Địa chỉ bind và cổng tương ứng từ `huy.env` (8007, 8008, 8009) |
| Catalog, Clinical, Diagnostic API | `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_PUBLIC_KEY_FILE` | Issuer và audience khớp Identity. Khi chạy ngoài Compose, trỏ đường dẫn tuyệt đối đến `infra/certs/jwt_public.pem` |
| Catalog API | `REDIS_URL` | `UMC_REDIS_URL` từ `quan.env` |
| Catalog worker | `AMQP_URL` | `UMC_AMQP_URL` từ `quan.env` |
| Clinical và Diagnostic worker | `RABBITMQ_URL` | Cùng `UMC_AMQP_URL` từ `quan.env` |

Compose đã làm các mapping này với issuer và audience mặc định của nhóm. Khi chạy bằng Go trực tiếp, nạp và gán các biến tiến trình trước khi chạy từng lệnh. Catalog dùng chung JWT public key để xác minh lease theo mặc định. Ba service Huy dùng public key; private key dùng ở Identity.

Trước khi bật API và worker bản mới, kiểm tra migration ledger của từng DB. Schema yêu cầu Catalog đến `000004`, Clinical đến `000007`, Diagnostic đến `000003`. Nếu migration dừng vì thiếu người tạo giá hoặc thiếu snapshot thuốc lịch sử, đối chiếu dữ liệu gốc để sửa bản ghi rồi mới chạy lại. Thêm biến môi trường không khắc phục được các lỗi dữ liệu này.

## Điều kiện để demo bằng dữ liệu online

- Mỗi database online đã có schema/migration và dữ liệu demo tương ứng. Mỗi service chỉ truy cập database của mình; không tự chạy seed hoặc migration lên database chung khi chưa thống nhất với owner.
- CloudAMQP đã có vhost, exchange, queue, binding và ACL cho producer/consumer. Kết nối TLS thành công chưa chứng minh message được phát và nhận.
- JWT có một cặp khóa chung: Identity ký bằng private key; Gateway và API xác minh bằng public key/JWKS cùng cặp.
- Redis online cấp quyền đọc/ghi cho `umc:appointment:*`, `umc:catalog:v1:*`, `umc:clinical:v1:*` và `umc:diagnostic:v1:*`. Cả ba service Huy đọc URL `rediss://` dùng chung của Quân; quyền nghiệp vụ vẫn kiểm trong DB.

**Trạng thái Compose:** cấu hình chung chỉ chạy 9 API, 9 worker nghiệp vụ, Gateway và web. Database, RabbitMQ và Redis đều lấy từ ba env của nhóm. Không tạo hạ tầng hay seed riêng. Chạy `python tools/be/run.py`; thêm `--build` khi đổi source. Xem [hướng dẫn triển khai](../infra/compose/README.md).

Khi sửa biến kết nối, owner cập nhật đúng file `.env.example`, code/Compose đọc biến và tài liệu này. Ba file `.env` thật chỉ cập nhật trên máy chạy service.
