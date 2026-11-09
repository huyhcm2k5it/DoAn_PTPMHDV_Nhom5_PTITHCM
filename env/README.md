# Env theo owner

Ba file thật duy nhất cho stack chung là `env/quan.env`, `env/huy.env`, `env/hung.env`. Mỗi owner tạo file của mình từ file `.example` cùng tên. Git bỏ qua ba file thật; chỉ commit mẫu không có mật khẩu. Trao đổi giá trị thật qua kênh riêng của nhóm, không đưa lên GitHub.

| Owner | File | Biến chính |
| --- | --- | --- |
| Quân | `quan.env` | MongoDB, RabbitMQ, Appointment Redis |
| Huy | `huy.env` | Catalog/Clinical/Diagnostic PostgreSQL, Catalog Redis |
| Hưng | `hung.env` | PostgreSQL chung, Identity/Billing/Notification |

Chạy từ gốc repo sau khi đủ ba file, khóa JWT và Mongo keyfile:

```powershell
docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml config --quiet
docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml up -d --build
```

Compose dùng `env/quan.env` trực tiếp cho container RabbitMQ và `env/hung.env` cho ba service Python. Ba `--env-file` cung cấp biến để Compose nội suy cho toàn stack. `rabbitmq` và `postgres` là hostname **bên trong** Compose network; chúng không tự truy cập được từ máy khác. `RABBITMQ_DEFAULT_PASS`, `RABBITMQ_PASSWORD` và mật khẩu trong `UMC_AMQP_URL` phải giống nhau nếu dùng một tài khoản demo. Trong URL phải percent-encode ký tự đặc biệt của user/password; ví dụ `@` thành `%40`. Biến cũ `RABBITMQ_ADMIN_USER/PASSWORD` không được Compose sử dụng để tạo broker account. RabbitMQ vẫn cần import `rabbitmq/definitions.json` và kiểm ACL trước khi nghiệm thu message.

Không thay mật khẩu của volume DB/RabbitMQ đã khởi tạo rồi mà không cập nhật user trong DB/broker: biến `*_DEFAULT_*` và init scripts chỉ có tác dụng khi volume còn mới.
