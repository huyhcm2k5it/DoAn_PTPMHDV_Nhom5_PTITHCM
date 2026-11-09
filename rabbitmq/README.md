# RabbitMQ

RabbitMQ chạy trong private Compose network, dùng vhost `/umc-care`. [definitions.json](definitions.json) chứa exchange, quorum queue và binding cho cả 9 service. Compose không tự import file này hoặc tự cấp ACL publisher/consumer: owner broker phải import và cấp quyền trước khi chạy worker.

Compose không publish `5672`/`15672` ra host. Worker trong cùng Compose dùng hostname `rabbitmq`; service chạy trên máy khác cần một broker reachable và URL/credential/vhost do owner hạ tầng cấp. Chạy mỗi người một RabbitMQ local tạo ra các broker tách biệt, message không tự chuyển giữa chúng. Docker Hub chỉ phân phối image, không đồng bộ queue hay dữ liệu broker.

- `umc.commands.appointment.v1` / `billing.request-charge.v1` -> `cmd.billing.v1`.
- `umc.commands.billing.v1` and `umc.commands.clinical.v1` -> `cmd.appointment.v1`.
- Billing/Clinical events -> `evt.appointment.v1`; Identity/Patient/Catalog projections -> dedicated Appointment queues.
- Appointment failures -> durable `dlq.appointment.v1` through `umc.deadletters.appointment.v1`.

Các route có trong JSON chưa chứng minh message đã chạy thật. Khi nghiệm thu, kiểm publisher confirm/mandatory return, consumer ACK sau commit, retry/quarantine và replay trên broker cô lập. Credential local của broker và worker nằm trong [env/quan.env](../env/README.md); file thật không commit.
