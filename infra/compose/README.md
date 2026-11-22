# Docker local và triển khai online

## Chạy đúng project và env nhóm

Launcher `tools/be/run.py` thay cho launcher test cũ, dùng ba file env thật hiện có. Ứng dụng Docker dùng trực tiếp DB, RabbitMQ và Redis online. Không sinh env, JWT, dữ liệu seed hoặc project thay thế.

```powershell
python tools/be/run.py --build
python tools/be/run.py ps
```

API Huy chạy migration trước readiness; các worker được bật sau bước API healthy. Web ở http://127.0.0.1:15173, Gateway theo cổng của Quân. Compose chỉ có 9 API, 9 worker nghiệp vụ, Gateway và web. Không có container database, RabbitMQ, Redis hoặc migrate riêng.

## Triển khai với dữ liệu online

Mục tiêu demo của nhóm là dùng cùng MongoDB Atlas, Neon, Aiven, CloudAMQP và một Redis online để ba máy thấy cùng dữ liệu và sự kiện. Docker Hub chỉ phân phối image ứng dụng; image không đồng bộ database hoặc queue. Mỗi service phải dùng credential và database đúng owner. Danh sách biến nằm ở [env theo owner](../../env/README.md).

## Chuẩn bị theo thứ tự

1. Quân cấp ba MongoDB URI riêng, **một** `UMC_REDIS_URL` cho Appointment và ba service Huy, cùng **một** `UMC_AMQP_URL` CloudAMQP; xác nhận host, TLS port, vhost, ACL và topology RabbitMQ.
2. Huy cấp ba Neon URL riêng cho Catalog, Clinical, Diagnostic. Chạy migration đúng từng database trước khi bật API/worker.
3. Hưng cấu hình ba database Aiven và SMTP theo [mẫu env](../../env/hung.env.example). Giữ public PEM chuẩn trên `develop`. Trên máy Identity đặt private PEM cùng cặp và chạy `node tools/quan/prepare-gateway-key.js --verify-identity`. Nếu không khớp, tìm đúng private PEM trước khi triển khai. Chuyển JWKS public đã xác minh sang máy Gateway nếu chạy riêng.
4. Mỗi owner tạo file `.env` thật từ mẫu của mình, thay placeholder và giữ file đó ngoài Git. Kiểm tra DNS, TLS, quyền đăng nhập, schema và dữ liệu demo trên từng nhà cung cấp. Dùng cùng broker/vhost cho tất cả worker.
5. Khởi chạy migrate, API và worker theo thứ tự phụ thuộc. Publisher, expiry và reconcile chạy ở worker riêng; HTTP health không xác nhận outbox đã được xử lý. Kiểm một hành trình có JWT thật, dữ liệu đọc được từ database online và message đi qua CloudAMQP đến consumer.

## Cấu hình và thứ tự khởi động

`compose.yaml` đã truyền `UMC_REDIS_URL` của Quân cho Appointment và ba service Huy qua TLS. File gốc chỉ chạy ứng dụng và dùng endpoint từ env nhóm. Worker chờ API của mình healthy; Gateway chờ đủ 9 API; web chờ Gateway. Không cần override hoặc Compose thứ hai. Compose lấy khóa ký từ private PEM được mount trên máy Identity.

Lệnh `docker compose ... config --quiet` chỉ kiểm cú pháp và biến bắt buộc, không kiểm kết nối DB, broker, quyền, schema hay cặp khóa JWT. Không in toàn bộ cấu hình sau nội suy vì có thể lộ credential. Không lấy kết quả health hoặc kết nối TCP/TLS làm bằng chứng hành trình nghiệp vụ đã thông suốt.

## Dữ liệu demo và kiểm tra luồng

- Mỗi owner chạy migration và seed chỉ trên database online mình quản lý, sau khi thống nhất dữ liệu chung. Không reset hoặc ghi đè dữ liệu shared để kiểm thử.
- Pharmacy có `node scripts/migrate-storage.js` để kiểm migration trước khi dùng `--apply`, và `node scripts/seed-demo.js --dry-run` để xem seed trước khi ghi. Chỉ thực hiện trên `pharmacy_db` online đã được Quân xác nhận.
- Appointment phát `QueueTicketChanged` cho Clinical. Nếu cần bù vé cũ, Quân kiểm snapshot theo ngày bằng exporter trước, rồi chạy lại với `--enqueue --apply` để đưa vé thật vào outbox. Clinical chỉ tạo lượt khám sau khi Appointment chấp nhận claim.
- Kiểm JWT do Identity phát qua Gateway, quyền của Clinical/Diagnostic, event RabbitMQ và trạng thái cuối của các request HTTP `202`. Theo dõi `statusUrl` và projection tương ứng.
- [Gate Pharmacy](../../tests/e2e/gate4-pharmacy.md), [ma trận quyền](../../tests/e2e/access-matrix.md) và [recovery](../../tests/e2e/recovery.md) là tiêu chí kiểm demo; chỉ đánh dấu đạt khi có bằng chứng chạy với các dịch vụ online cùng môi trường.
- [Nghiệm thu hai luồng khám](../../tests/e2e/care-integration.md) ghi thứ tự triển khai, các bước kiểm qua Gateway và cách đối chiếu hai dead-letter queue.

## Các lần chạy sau

- `python tools/be/run.py`: kiểm tra ba env, xác minh khóa có sẵn và bật cả nhóm bằng image đã build. Thêm `--build` khi mới lấy source hoặc vừa sửa code. Không sinh khóa/DB/dữ liệu thay thế.
- `python tools/be/run.py ps`: trạng thái toàn hệ thống.
- `python tools/be/run.py logs`: log gần nhất.
- `python tools/be/run.py down`: dừng container ứng dụng, giữ dữ liệu online.

Cần Docker Engine Linux; launcher dùng Python chuẩn, không cần cài thư viện Python để chạy. Cặp PEM nhóm phải có sẵn ở vị trí mount. Công cụ JWKS hiện có được gọi bằng Node trên máy, hoặc Node container `--rm` nếu máy chưa cài Node. Dockerfile từng service vẫn được giữ; API và worker dùng chung build của service, khác lệnh chạy. Cache build được dùng lại, không cài lại dependency khi lockfile không đổi.
