# Notification Service

Owner: Hưng. Django/PostgreSQL; lưu thông báo cho đúng `recipientUserId` và trạng thái đã đọc. Xem [OpenAPI](../../contracts/http/notification.openapi.json) và [RabbitMQ topology](../../rabbitmq/definitions.json).

## Chạy local

Hưng điền `env/hung.env` theo [mẫu chung](../../env/README.md); Quân cung cấp RabbitMQ credential qua `env/quan.env`. Compose nạp hai nhóm biến cho Notification; chạy native cần export biến và đổi DB/broker host cho phù hợp. Khi PostgreSQL sẵn sàng:

```powershell
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

Chạy `python manage.py run_notification_worker` riêng để nhận event và ghi inbox/thông báo. API gồm GET `/api/v1/notifications` và PATCH `/api/v1/notifications/{notificationId}/read`; cả hai yêu cầu xác thực. Kiểm tra `/health/live`, `/health/ready` và test trong `tests/`. Khi tích hợp, kiểm event lặp, retry/quarantine và không dùng `patientId` thay cho `recipientUserId`.
