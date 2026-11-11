# Triển khai UMC Care với dịch vụ dữ liệu online

Mục tiêu demo của nhóm là dùng cùng MongoDB Atlas, Neon, Aiven, CloudAMQP và một Redis online để ba máy thấy cùng dữ liệu và sự kiện. Docker Hub chỉ phân phối image ứng dụng; image không đồng bộ database hoặc queue. Mỗi service phải dùng credential và database đúng owner. Danh sách biến nằm ở [env theo owner](../../env/README.md).

## Chuẩn bị theo thứ tự

1. Quân cấp ba MongoDB URI riêng, **một** `UMC_REDIS_URL` cho Appointment và Catalog, cùng **một** `UMC_AMQP_URL` CloudAMQP; xác nhận host, TLS port, vhost, ACL và topology RabbitMQ.
2. Huy cấp ba Neon URL riêng cho Catalog, Clinical, Diagnostic. Chạy migration đúng từng database trước khi bật API/worker.
3. Hưng cấp ba bộ thông tin Aiven cho Identity, Billing, Notification, private key JWT và cấu hình SMS. Public key cùng cặp phải được đặt tại `infra/certs/jwt_public.pem`; chạy `node tools/quan/prepare-gateway-key.js` để tạo JWKS cho Gateway. Không đưa private key lên Git.
4. Mỗi owner tạo file `.env` thật từ mẫu của mình, thay placeholder và giữ file đó ngoài Git. Kiểm tra DNS, TLS, quyền đăng nhập, schema và dữ liệu demo trên từng nhà cung cấp. Dùng cùng broker/vhost cho tất cả worker.
5. Khởi chạy migrate, API và worker theo thứ tự phụ thuộc. Publisher, expiry và reconcile chạy ở worker riêng; HTTP health không xác nhận outbox đã được xử lý. Kiểm một hành trình có JWT thật, dữ liệu đọc được từ database online và message đi qua CloudAMQP đến consumer.

## Giới hạn của Compose hiện tại

`compose.yaml` đã truyền `UMC_REDIS_URL` của Quân cho Appointment và Catalog qua TLS. Nó vẫn dựng MongoDB, PostgreSQL và RabbitMQ container, chạy bootstrap tương ứng và yêu cầu một số mật khẩu khởi tạo. Vì vậy chỉ điền ba `.env.example` online rồi chạy Compose **chưa tạo ra stack online hoàn chỉnh**. Trước demo online bằng Compose, cần chuyển các dependency/healthcheck của hạ tầng sang dịch vụ được quản lý, bỏ bootstrap dữ liệu container không dùng. `JWT_PRIVATE_KEY_B64` cũng chưa được tự giải mã bởi Compose. Chủ từng phần cần hoàn thiện các bước này trong code/Compose; README không thay thế được cấu hình chạy thật.

Lệnh `docker compose ... config --quiet` chỉ kiểm cú pháp và biến bắt buộc, không kiểm kết nối DB, broker, quyền, schema hay cặp khóa JWT. Không in toàn bộ cấu hình sau nội suy vì có thể lộ credential. Không lấy kết quả health hoặc kết nối TCP/TLS làm bằng chứng hành trình nghiệp vụ đã thông suốt.

## Dữ liệu demo và kiểm tra luồng

- Mỗi owner chạy migration và seed chỉ trên database online mình quản lý, sau khi thống nhất dữ liệu chung. Không reset hoặc ghi đè dữ liệu shared để kiểm thử.
- Pharmacy có `node scripts/migrate-storage.js` để kiểm migration trước khi dùng `--apply`, và `node scripts/seed-demo.js --dry-run` để xem seed trước khi ghi. Chỉ thực hiện trên `pharmacy_db` online đã được Quân xác nhận.
- Appointment có `node services/appointment/scripts/export-clinical-tickets.js --date=YYYY-MM-DD` để xuất snapshot FIRST/RETURN cho Clinical khi feed ticket chưa sẵn sàng. Snapshot này chưa tự cấp quyền lượt khám; cần kiểm mapping bác sĩ và visit.
- Kiểm JWT do Identity phát qua Gateway, quyền của Clinical/Diagnostic, event RabbitMQ và trạng thái cuối của các request HTTP `202`. Theo dõi `statusUrl` và projection tương ứng.
- [Gate Pharmacy](../../tests/e2e/gate4-pharmacy.md), [ma trận quyền](../../tests/e2e/access-matrix.md) và [recovery](../../tests/e2e/recovery.md) là tiêu chí kiểm demo; chỉ đánh dấu đạt khi có bằng chứng chạy với các dịch vụ online cùng môi trường.
