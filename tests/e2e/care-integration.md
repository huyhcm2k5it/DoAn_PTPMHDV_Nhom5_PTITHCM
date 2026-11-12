# Nghiệm thu hai luồng khám qua Gateway

Chạy với các tài khoản thử, dữ liệu thử và cùng vhost online. Lưu commit, thời điểm, mã lỗi, correlation ID và ID nghiệp vụ của từng bước. Kết quả health, test cô lập và dữ liệu mẫu chỉ xác nhận phần tương ứng của hệ thống.

## Triển khai theo thứ tự

1. Hưng chuẩn bị private PEM khớp với public PEM trên `develop`. Trên máy Identity chạy `node tools/quan/prepare-gateway-key.js --verify-identity`. Sau khi lệnh thành công, đưa JWKS công khai sang Gateway và khởi động lại các tiến trình dùng bản mount cũ. Đăng nhập để lấy access token mới. Kiểm một route bảo vệ bằng token hợp lệ, và kiểm token từ cặp khóa khác cho kết quả `401` trong môi trường test cô lập.
2. Điền SMTP và thông tin DB trên máy chạy theo [hướng dẫn env](../../env/README.md). Chạy `docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml config --quiet` từ repo gốc. Kiểm tra API và worker Identity dùng cùng DB Aiven và cùng vhost của nhóm. Đăng ký và xác minh OTP qua hộp thư nhận thử. Đối chiếu thời điểm phát outbox và bản ghi `IdentityAccessChanged` ở một consumer.
3. Quân áp dụng các binding mới từ definitions lên đúng vhost. Huy chạy migration Clinical, triển khai consumer Clinical/Diagnostic, sau đó mới bật publisher Appointment/Clinical. Đối chiếu `QueueTicketChanged` và checkpoint `VisitDoctorGrantChanged` đã tới đúng queue. Chỉ dùng override online đã xác nhận cùng DB, Redis và broker ở API lẫn worker.
4. Với vé cũ, Quân rà bản xuất theo ngày và mapping bác sĩ trước khi dùng `node services/appointment/scripts/export-clinical-tickets.js --date=YYYY-MM-DD --enqueue --apply` trên Appointment DB của môi trường đó. Với lượt khám đã tồn tại, Huy đối chiếu phân công và chạy `go run ./cmd/visit-grant -visit-id <UUID> -apply` từ service Clinical để đưa snapshot vào outbox. Thêm `-revoke` để thu hồi quyền của lượt đó.

## Ca khám và ca đối soát

| Ca | Thực hiện | Kết quả cần lưu |
| --- | --- | --- |
| Không LAB | Giữ chỗ, đặt lịch, thanh toán thử, check-in, nhận vé FIRST, lưu ghi chú và ký khám, ký toa, giữ thuốc, thanh toán và cấp thuốc. | Một lượt khám, một phí khám, lịch `COMPLETED`, toa `FINAL`, phiếu cấp thuốc và biên nhận tương ứng. |
| Có LAB | Lặp bước đặt lịch đến nhận vé FIRST. Tạo chỉ định, thanh toán LAB, lấy mẫu, nhập kết quả và dùng tài khoản reviewer khác để công bố. Nhận vé RETURN rồi ký khám, ký toa và cấp thuốc. | Kết quả `PUBLISHED`, RETURN dùng lại `visitId` và phí khám ban đầu. Bác sĩ phụ trách xem được kết quả đã công bố sau khi ký. |
| Hủy LAB | Tạo một order thử khác đã thanh toán và chưa lấy mẫu. Bác sĩ phụ trách xin lease `DI-012` rồi hủy. Thu ngân tạo yêu cầu hoàn, chạy mô phỏng thất bại rồi thử lại thành công. | Diagnostic lần lượt thấy `PENDING_SYNC`, `REQUESTED`, `FAILED`, `SUCCEEDED`. Phát trùng hoặc đến muộn giữ đúng trạng thái. Order đã từng lấy mẫu trả `409` khi hủy. |

Poll `statusUrl` với thao tác trả `202`. Kiểm tra lại bằng bác sĩ khác và sau khi thu hồi quyền để xác nhận dữ liệu của lượt không bị lộ. Mỗi môi trường phải có đủ tài khoản bác sĩ, LAB_TECH, LAB_REVIEW, thu ngân và dược sĩ cho ca thử.

## Phân loại dead-letter

1. Quân xác nhận tên hai queue, vhost, thời điểm chụp số lượng và tổng message. Ưu tiên bản lưu của owner thay vì đọc lặp rồi requeue từ queue quorum. Lưu bản xuất cục bộ trong `.runtime/`.
2. Chuẩn bị một mảng JSON cho mỗi queue. Mỗi phần tử có `reasonCode`, `routingKey` và `body` là envelope gốc hoặc chuỗi JSON/base64. Thêm `inboxStatus: "PROCESSED"` chỉ khi đã đối chiếu inbox của đúng consumer. Dùng lệnh dưới đây với tên queue thật.

   ```powershell
   python tools/be/triage_dead_letters.py --expected 660 --queue QUEUE_A .runtime/queue-a.json --queue QUEUE_B .runtime/queue-b.json
   ```

3. Kiểm lại từng nhóm lỗi tạm thời, bản lặp, lỗi schema hoặc nguồn và ca cần owner xác minh. Một lỗi tạm thời chỉ đủ điều kiện phát lại sau khi nguyên nhân đã sửa và đối chiếu thấy hiệu ứng nghiệp vụ còn thiếu. Với inbox `DEAD`, phát lại thẳng cùng ID sẽ bị consumer bỏ qua. Owner phải dùng quy trình mở lại retry có kiểm soát cho bản ghi đó trước khi phát lại.
4. Chạy một lô nhỏ trên môi trường nghiệm thu trước, giữ nguyên ID và nội dung của bản gốc. Đối chiếu inbox, trạng thái nghiệp vụ, số khoản thu/hoàn/phiếu cấp thuốc và số dead-letter mới. Dừng khi có giao dịch lặp, xung đột hash hoặc lỗi mới. Giữ nguyên bản lưu để đối chiếu.
