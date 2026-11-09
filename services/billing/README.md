# Billing Service

Owner: Hưng. Django/PostgreSQL; sở hữu charge, settlement, payment, receipt và refund. Xem [OpenAPI](../../contracts/http/billing.openapi.json), [message schema](../../contracts/messages/billing.v1.schema.json) và [RabbitMQ topology](../../rabbitmq/definitions.json).

## Chạy local

Hưng điền `env/hung.env` theo [mẫu chung](../../env/README.md); Quân cung cấp RabbitMQ credential qua `env/quan.env`. Compose nạp hai nhóm biến cho Billing; chạy native cần export biến và đổi DB/broker host cho phù hợp. Khi PostgreSQL sẵn sàng:

```powershell
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 127.0.0.1:8005
```

Chạy `python manage.py run_billing_worker` riêng để nhận command/event và phát outbox. Compose đã tách API và worker. `/health/ready` không chứng minh saga thanh toán xuyên service đã xong.

## Luồng và kiểm tra

Appointment, Diagnostic, Pharmacy gửi `RequestCharge` và `QuerySettlement`; Billing phát `ChargePrepared`, `ChargePaid`, `SettlementDecision`, `BillingStatusChanged` và gửi `ReserveSettlement` cho source owner. Owner phản hồi `SettlementReserved` kèm fence. Refund cần bằng chứng hủy từ owner. Test code nằm trong `tests/`; khi ghép phải kiểm event lặp/đến muộn, `UNKNOWN`/`FAILED` và refund retry.
