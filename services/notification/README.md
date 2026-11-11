# Notification Service

Owner: Hưng. Django/PostgreSQL; lưu thông báo cho đúng `recipientUserId` và trạng thái đã đọc. Xem [OpenAPI](../../contracts/http/notification.openapi.json) và [RabbitMQ topology](../../rabbitmq/definitions.json).

## Chạy với database và broker online

Hưng điền `env/hung.env` theo [mẫu chung](../../env/README.md), với `NOTIFICATION_DB_*` trỏ Aiven và `NOTIFICATION_DB_SSLMODE=require`; Quân cung cấp CloudAMQP qua `env/quan.env`. API và worker phải dùng cùng database online và broker/vhost của nhóm. Khi schema online đã sẵn sàng:

Dockerfile của service cài dependencies, chạy migration rồi mở API bằng Gunicorn trên cổng 8004–8006 tương ứng. Khi triển khai, nạp env thật vào container và chỉ cho Gateway truy cập API.

Chạy `python manage.py run_notification_worker` riêng để nhận event và ghi inbox/thông báo. API gồm GET `/api/v1/notifications` và PATCH `/api/v1/notifications/{notificationId}/read`; cả hai yêu cầu xác thực. Kiểm tra `/health/live`, `/health/ready` và test trong `tests/`. Khi tích hợp, kiểm event lặp, retry/quarantine và không dùng `patientId` thay cho `recipientUserId`.
