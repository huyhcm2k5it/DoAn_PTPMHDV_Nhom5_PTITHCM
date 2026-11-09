# Env theo owner

Ba file thật duy nhất cho stack chung là `env/quan.env`, `env/huy.env`, `env/hung.env`. Mỗi owner tạo file của mình từ file `.example` cùng tên. Git bỏ qua ba file thật; chỉ commit mẫu không có mật khẩu. Trao đổi giá trị thật qua kênh riêng của nhóm, không đưa lên GitHub.

| Owner | File | Biến chính |
| --- | --- | --- |
| Quân | `quan.env` | MongoDB, RabbitMQ, Appointment Redis |
| Huy | `huy.env` | Catalog/Clinical/Diagnostic PostgreSQL, Catalog Redis |
| Hưng | `hung.env` | PostgreSQL chung, Identity/Billing/Notification |

## Cổng của stack

| Thành phần | Cổng trong Compose | Khai báo tại | Cổng mở trên máy host |
| --- | ---: | --- | --- |
| Gateway/Envoy | 8080 | `GATEWAY_HOST_PORT` của Quân | `127.0.0.1:8080` mặc định |
| Patient, Appointment, Pharmacy | 8001, 8002, 8003 | `PATIENT_PORT`, `APPOINTMENT_PORT`, `PHARMACY_PORT` của Quân | Không mở |
| Identity, Billing, Notification | 8004, 8005, 8006 | `IDENTITY_PORT`, `BILLING_PORT`, `NOTIFICATION_PORT` của Hưng | Không mở |
| Catalog, Clinical, Diagnostic | 8007, 8008, 8009 | `CATALOG_PORT`, `CLINICAL_PORT`, `DIAGNOSTIC_PORT` của Huy | Không mở trong Compose chung |
| MongoDB, RabbitMQ, PostgreSQL, Redis | 27017, 5672, 5432, 6379 | Cổng có trong URI/DSN tương ứng; `RABBITMQ_PORT` dùng cho kết nối RabbitMQ | Không mở |

Các biến cổng service là **hợp đồng hiện tại** của Envoy, healthcheck và Dockerfile; không tự ý đổi riêng một giá trị. `GATEWAY_HOST_PORT` là cổng host duy nhất được Compose nội suy, còn cổng trong container Gateway vẫn là 8080. Compose riêng của Huy (`infra/compose/huy.catalog.yml`) mở loopback 55432, 56379, 8007, 8008, 8009 và không phải stack chung.

## Chọn kết nối local hoặc online

- **Quân:** `PATIENT_MONGO_URI`, `APPOINTMENT_MONGO_URI`, `PHARMACY_MONGO_URI` trỏ đúng ba owner DB. Online dùng URI `mongodb+srv://...` do chủ DB cấp. `UMC_AMQP_URL` trỏ một RabbitMQ chung; online TLS dùng `amqps://...:5671/%2Fumc-care`, đồng thời đặt `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_VHOST`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD` tương ứng. `RABBITMQ_DEFAULT_*` chỉ khởi tạo container RabbitMQ local.
- **Huy:** `CATALOG_DATABASE_URL`, `CLINICAL_DATABASE_URL`, `DIAGNOSTIC_DATABASE_URL` là ba DSN được API, migrate và worker sử dụng trực tiếp. Online PostgreSQL dùng host/DB/user của từng owner và `sslmode=require`; không chỉ thay `*_DB_PASSWORD` vì biến đó dành cho bootstrap PostgreSQL local. `HUY_AMQP_URL` là URL RabbitMQ cho ba worker của Huy.
- **Hưng:** mỗi nhóm `IDENTITY_DB_*`, `BILLING_DB_*`, `NOTIFICATION_DB_*` phải có `NAME`, `USER`, `PASSWORD`, `HOST`, `PORT`, `SSLMODE`. Với PostgreSQL online, đặt `SSLMODE=require`. `POSTGRES_PASSWORD` vẫn dành cho container bootstrap local. `HUNG_AMQP_URL` là URL RabbitMQ cho ba service của Hưng, hỗ trợ `amqps://`.

Compose vẫn khởi động các container DB/RabbitMQ local để thỏa dependency và bootstrap, ngay cả khi URL ứng dụng trỏ online. Vì vậy phải giữ các biến bootstrap local hợp lệ. Chỉ đổi URL/host trong file env không chuyển dữ liệu: database online cần schema/migration, dữ liệu demo và RabbitMQ online cần vhost, exchange, queue, binding, ACL tương ứng. Không chạy seed/migration lên DB online dùng chung khi chưa thống nhất với owner.

## Quy định bổ sung env

1. Mỗi biến có **một owner** và khai báo trong đúng một trong ba file. Quân quản lý Mongo/Rabbit/Appointment, Huy quản lý Catalog/Clinical/Diagnostic, Hưng quản lý Identity/Billing/Notification/PostgreSQL chung. Tránh định nghĩa trùng tên giữa ba file vì `--env-file` phía sau ghi đè file trước.
2. Khi thêm biến, owner sửa file `env/<owner>.env.example` bằng giá trị mẫu, cập nhật Compose/code đọc biến và bổ sung mục này nếu biến ảnh hưởng kết nối hoặc cổng. File thật `env/<owner>.env` được cập nhật riêng trên máy chạy demo.
3. Không commit ba file thật, DSN chứa mật khẩu, token hay private key. Gửi credential cho máy demo qua kênh riêng; không dán vào README, issue hoặc PR.
4. URI phải percent-encode user/password (`@` thành `%40`, `/` thành `%2F`). Ba service dùng chung đúng broker/vhost; mỗi service chỉ truy cập DB owner của mình.
5. Trước demo, chạy `docker compose ... config --quiet`, kiểm tra URL đã chọn bằng cách xem **tên host và cổng**, rồi thử kết nối/worker. Không in toàn bộ `docker compose config` hoặc env ra log vì sẽ lộ mật khẩu.

Chạy từ gốc repo sau khi đủ ba file, khóa JWT và Mongo keyfile:

```powershell
docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml config --quiet
docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml up -d --build
```

Compose dùng `env/quan.env` trực tiếp cho container RabbitMQ và `env/hung.env` cho ba service Python. Ba `--env-file` cung cấp biến để Compose nội suy cho toàn stack. `rabbitmq` và `postgres` là hostname **bên trong** Compose network; chúng không tự truy cập được từ máy khác. Khi dùng broker local với một tài khoản demo, `RABBITMQ_DEFAULT_PASS`, `RABBITMQ_PASSWORD` và mật khẩu trong `UMC_AMQP_URL` phải giống nhau. Biến cũ `RABBITMQ_ADMIN_USER/PASSWORD` không được Compose sử dụng để tạo broker account. RabbitMQ vẫn cần import `rabbitmq/definitions.json` và kiểm ACL trước khi nghiệm thu message.

Không thay mật khẩu của volume DB/RabbitMQ đã khởi tạo rồi mà không cập nhật user trong DB/broker: biến `*_DEFAULT_*` và init scripts chỉ có tác dụng khi volume còn mới.
