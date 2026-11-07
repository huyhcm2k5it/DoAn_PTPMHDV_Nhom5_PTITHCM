# Kiểm tra recovery — không tác động dữ liệu đang dùng

Trạng thái: kiểm thử Mongo replica cô lập đã chạy; RabbitMQ live và crash matrix chưa chạy
vì máy hiện không có Docker daemon.

## Lệnh đã có

- `powershell -File tools/quan/verify-local.ps1`: Mongo memory replica riêng cho từng suite,
  outbox confirm/mandatory return, DB retry sau restart logic, duplicate/quarantine và giữ khóa UNKNOWN.
- Job CI `pharmacy-broker`: RabbitMQ thật trong vhost `quan-ci-pharmacy`, Mongo replica tạm,
  chạy `node --test pharmacy-broker.integration.js` ở `tests/mongo`.
- Chạy broker test tại máy có broker: cấp riêng vhost bắt đầu `quan-ci-`,
  đặt TEST_AMQP_URL bằng secret local rồi chạy cùng lệnh.
  Script từ chối nếu URL không trỏ vhost test; không silently skip khi thiếu URL.
- Đã có restart worker + duplicate event + poison delivery và publish quarantine thật trong script;
  việc kill Mongo/broker tại mọi crash point dưới đây vẫn cần diễn tập riêng.

## Ma trận thực nghiệm còn chờ

| Điểm ngắt | Cách kiểm | Invariant phải thấy |
| --- | --- | --- |
| Trước Mongo commit | Dừng worker test khi transaction chưa commit | Không domain/outbox nửa vời |
| Sau commit trước ack | Dừng worker, bật lại | Inbox bỏ lặp, reserved/receipt/dispense không tăng lần hai |
| Sau publish trước mark | Dừng publisher sau broker confirm | Phát lại cùng messageId, receiver chỉ một effect |
| Broker dừng | Dừng broker trong project test riêng | Outbox còn pending, không tự unlock UNKNOWN |
| Mongo dừng | Dừng Mongo test | Không ack nếu chưa lưu domain/retry/quarantine bền vững |
| Poison/producer giả | Publish vào vhost test | dead_letters + outbox quarantine có body gốc/messageId |
| Ba retry thất bại | Lỗi owner có chủ đích trong test | 5/15/60 giây + jitter rồi quarantine |
| Phục hồi tất cả | Bật dependencies và worker | Drain có giới hạn, không hot requeue |

Appointment và Pharmacy đã dùng retry_jobs trong DB, không dựa TTL/DLX làm đường retry bền vững.
Các queue owner Quân trong definitions mới khai báo quorum.
Queue cũ kiểu classic không đổi type tại chỗ: cần owner drain/backup, tạo lại queue khi an toàn và rebind.
PRECONDITION_FAILED phải dừng để xử lý migration; không tự purge/delete queue hay xóa volume.

Không chạy `down -v`, reset hoặc xóa DB/queue của project đang dùng.
Mỗi thực nghiệm ghi commit, IDs giả, số document/trạng thái trước-sau, thời điểm và exit code vào local evidence.
