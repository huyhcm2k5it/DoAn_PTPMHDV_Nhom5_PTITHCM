# Billing Service

Owner: Hưng. Django/PostgreSQL; sở hữu charge, settlement, payment, receipt và refund. Xem [OpenAPI](../../contracts/http/billing.openapi.json), [message schema](../../contracts/messages/billing.v1.schema.json) và [RabbitMQ topology](../../rabbitmq/definitions.json).

## Chạy với database và broker online

Hưng điền `env/hung.env` theo [mẫu chung](../../env/README.md), với `BILLING_DB_*` trỏ Aiven và `BILLING_DB_SSLMODE=require`; Quân cung cấp CloudAMQP qua `env/quan.env`. API và worker phải dùng cùng database online và broker/vhost của nhóm. Khi schema online đã sẵn sàng:

Dockerfile của service cài dependencies, chạy migration rồi mở API bằng Gunicorn trên cổng 8004–8006 tương ứng. Khi triển khai, nạp env thật vào container và chỉ cho Gateway truy cập API.

Chạy `python manage.py run_billing_worker` riêng để nhận command/event và phát outbox. Compose đã tách API và worker. `/health/ready` không chứng minh saga thanh toán xuyên service đã xong.

## Nâng cấp Billing theo ERD 3NF

Chạy thử trên bản sao PostgreSQL trước khi nâng cấp DB dùng chung. Trong cửa sổ bảo trì, dừng các request ghi và worker Billing, sao lưu DB rồi chạy `python manage.py migrate app 0006_backfill_3nf`. Migration dừng nếu không xác định được chủ nguồn thu, liên kết saga hoặc chứng từ. Dùng mã bản ghi trong lỗi để đối soát với dữ liệu gốc. So sánh tổng tiền và số lượng chứng từ với bản sao trước khi chạy tiếp `python manage.py migrate app 0007_enforce_3nf` để siết khóa và gỡ cột lặp.

Giữ các tiến trình ghi ở trạng thái dừng giữa hai migration. Kiểm tra đọc khoản thu, biên nhận và luồng thanh toán qua worker trước khi mở ghi. Nếu phải quay lui trước khi mở ghi, khôi phục bản sao cùng phiên bản ứng dụng cũ. Sau khi nhận giao dịch mới, giữ dữ liệu mới và sửa tiến.

## Luồng và kiểm tra

Appointment, Diagnostic, Pharmacy gửi `RequestCharge` và `QuerySettlement`; Billing phát `ChargePrepared`, `ChargePaid`, `SettlementDecision`, `BillingStatusChanged` và gửi `ReserveSettlement` cho source owner. Owner phản hồi `SettlementReserved` kèm fence. Refund cần bằng chứng hủy từ owner. Test code nằm trong `tests/`; khi ghép phải kiểm event lặp/đến muộn, `UNKNOWN`/`FAILED` và refund retry.
