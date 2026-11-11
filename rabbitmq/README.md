# RabbitMQ

Quân quản lý một broker CloudAMQP online, một vhost và `UMC_AMQP_URL` dùng chung cho 9 service. URL dùng `amqps://` với TLS; host, cổng và vhost lấy từ CloudAMQP. [definitions.json](definitions.json) chứa exchange, quorum queue và binding. Owner broker đối chiếu định nghĩa với vhost online, import topology và cấp ACL publisher/consumer trước khi chạy worker.

Hưng còn đọc `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_VHOST`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`; các biến này phải chỉ cùng broker/vhost với `UMC_AMQP_URL`. Giá trị thật nằm trong `env/quan.env` và không được commit. Compose hiện vẫn dựng RabbitMQ container; xem [giới hạn triển khai online](../infra/compose/README.md).

- `umc.commands.appointment.v1` / `billing.request-charge.v1` -> `cmd.billing.v1`.
- `umc.commands.billing.v1` and `umc.commands.clinical.v1` -> `cmd.appointment.v1`.
- Billing/Clinical events -> `evt.appointment.v1`; Identity/Patient/Catalog projections -> dedicated Appointment queues.
- Appointment failures -> durable `dlq.appointment.v1` through `umc.deadletters.appointment.v1`.

Các route có trong JSON chưa chứng minh message đã chạy thật. Khi nghiệm thu, kiểm publisher confirm/mandatory return, consumer ACK sau commit, retry/quarantine và replay bằng một message thật trên broker dùng cho demo.
