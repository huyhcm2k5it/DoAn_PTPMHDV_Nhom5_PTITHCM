# Cấu hình online theo owner

Nhóm dùng chung MongoDB Atlas, Neon PostgreSQL, Aiven PostgreSQL, CloudAMQP và một Redis online. Mỗi người giữ đúng một file thật: `env/quan.env`, `env/huy.env`, `env/hung.env`. Tạo từ file `.env.example` tương ứng, thay toàn bộ `REPLACE`, rồi chia sẻ credential qua kênh riêng. Git chỉ lưu file mẫu.

| Owner | File | Phạm vi |
| --- | --- | --- |
| Quân | `quan.env` | Patient, Appointment, Pharmacy; ba MongoDB URI, Redis và RabbitMQ chung |
| Huy | `huy.env` | Ba Neon PostgreSQL URL cho Catalog, Clinical, Diagnostic |
| Hưng | `hung.env` | Ba database Identity, Billing, Notification trên Aiven; khóa ký JWT và SMS |

## Cổng và địa chỉ

| Thành phần | Cổng ứng dụng | Owner |
| --- | ---: | --- |
| Gateway | 8080 | Quân |
| Patient, Appointment, Pharmacy | 8001–8003 | Quân |
| Identity, Billing, Notification | 8004–8006 | Hưng |
| Catalog, Clinical, Diagnostic | 8007–8009 | Huy |

Các cổng ứng dụng là hợp đồng với Gateway và healthcheck; đổi cổng phải đổi cả cấu hình định tuyến. Cổng database/broker do nhà cung cấp online cấp, không dùng cổng container làm địa chỉ kết nối. CloudAMQP TLS thường dùng `5671`; lấy host, vhost và cổng thực tế từ dashboard của broker.

## Giá trị cần điền

1. **Quân:** mỗi `*_MONGO_URI` phải trỏ đúng database của service sở hữu. `UMC_AMQP_URL=amqps://USER:PASSWORD@HOST:PORT/VHOST` là URL broker duy nhất của nhóm. Các biến `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_VHOST`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD` phải khớp URL đó vì service Hưng còn đọc dạng tách trường. `UMC_REDIS_URL=rediss://USER:PASSWORD@HOST:PORT/0` là URL Redis chung; Compose truyền nó cho Appointment và Catalog.
2. **Huy:** `CATALOG_DATABASE_URL`, `CLINICAL_DATABASE_URL`, `DIAGNOSTIC_DATABASE_URL` trỏ ba database Neon riêng, có `sslmode=require`. Worker Huy nhận RabbitMQ từ `UMC_AMQP_URL`; Catalog API nhận Redis từ `UMC_REDIS_URL`, cả hai do Quân quản lý.
3. **Hưng:** mỗi bộ `IDENTITY_DB_*`, `BILLING_DB_*`, `NOTIFICATION_DB_*` có tên database, host, port, user, password và `SSLMODE=require` của Aiven. Hưng sở hữu duy nhất private key JWT và `DJANGO_SECRET_KEY`. `JWT_PRIVATE_KEY_B64` trong mẫu chưa được Compose/code tự nạp; cần giải mã thành private PEM trên máy chạy Identity. Public PEM cùng cặp cấp cho Gateway và các service xác minh, rồi tạo JWKS bằng `node tools/quan/prepare-gateway-key.js`. `JWT_ISSUER` và `JWT_AUDIENCE` phải khớp ở bên phát và bên xác minh token.

Mật khẩu nằm trong URI phải được percent-encode (`@` → `%40`, `/` → `%2F`). Base64 không mã hóa private key. Không commit file thật, DSN có mật khẩu, token, khóa riêng hoặc output của `docker compose config`.

## Điều kiện để demo bằng dữ liệu online

- Mỗi database online đã có schema/migration và dữ liệu demo tương ứng. Mỗi service chỉ truy cập database của mình; không tự chạy seed hoặc migration lên database chung khi chưa thống nhất với owner.
- CloudAMQP đã có vhost, exchange, queue, binding và ACL cho producer/consumer. Kết nối TLS thành công chưa chứng minh message được phát và nhận.
- JWT có một cặp khóa chung: Identity ký bằng private key; Gateway và API xác minh bằng public key/JWKS cùng cặp.
- Redis online cấp quyền đọc/ghi cho hai namespace khóa `umc:appointment:*` và `umc:catalog:v1:*`. Catalog parse `rediss://` và dùng TLS; kiểm quyền của cùng tài khoản trên cả hai namespace trước demo.

**Trạng thái Compose:** Redis đã được nối tới URL online của Quân, nhưng `infra/compose/compose.yaml` vẫn khai báo container MongoDB, PostgreSQL và RabbitMQ cùng một số biến khởi tạo của chúng. Ba file mẫu online chưa đủ để chạy Compose đó. Không dùng lệnh `up` từ Compose hiện tại như bằng chứng toàn bộ hạ tầng đã chuyển online. Xem [hướng dẫn triển khai](../infra/compose/README.md) để biết phần còn phải đổi trước khi demo.

Khi sửa biến kết nối, owner cập nhật đúng file `.env.example`, code/Compose đọc biến và tài liệu này. Ba file `.env` thật chỉ cập nhật trên máy chạy service.
