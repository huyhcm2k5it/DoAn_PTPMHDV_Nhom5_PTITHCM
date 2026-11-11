# Billing Service

Owner: Hưng. Django/PostgreSQL; sở hữu charge, settlement, payment, receipt và refund. Xem [OpenAPI](../../contracts/http/billing.openapi.json), [message schema](../../contracts/messages/billing.v1.schema.json) và [RabbitMQ topology](../../rabbitmq/definitions.json).

## Chạy với database và broker online

Hưng điền `env/hung.env` theo [mẫu chung](../../env/README.md), với `BILLING_DB_*` trỏ Aiven và `BILLING_DB_SSLMODE=require`; Quân cung cấp CloudAMQP qua `env/quan.env`. API và worker phải dùng cùng database online và broker/vhost của nhóm. Khi schema online đã sẵn sàng:

Dockerfile của service cài dependencies, chạy migration rồi mở API bằng Gunicorn trên cổng 8004–8006 tương ứng. Khi triển khai, nạp env thật vào container và chỉ cho Gateway truy cập API.

Chạy `python manage.py run_billing_worker` riêng để nhận command/event và phát outbox. Compose đã tách API và worker. `/health/ready` không chứng minh saga thanh toán xuyên service đã xong.

## Luồng và kiểm tra

Appointment, Diagnostic, Pharmacy gửi `RequestCharge` và `QuerySettlement`; Billing phát `ChargePrepared`, `ChargePaid`, `SettlementDecision`, `BillingStatusChanged` và gửi `ReserveSettlement` cho source owner. Owner phản hồi `SettlementReserved` kèm fence. Refund cần bằng chứng hủy từ owner. Test code nằm trong `tests/`; khi ghép phải kiểm event lặp/đến muộn, `UNKNOWN`/`FAILED` và refund retry.
