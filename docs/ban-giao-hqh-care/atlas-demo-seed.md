# Dữ liệu Atlas DEMO cho giao diện và tìm kiếm

Batch: `umc-ui-demo-v1`, lịch từ **11/11/2026 đến 10/12/2026**, múi giờ Việt Nam.
Toàn bộ tên và liên hệ là giả lập. Hồ sơ có tiền tố `DEMO`; số liên hệ bắt đầu bằng
`000` để không dùng số điện thoại thật. UUID ổn định giúp chạy lại không trùng.

| Database | Collection | Số bản ghi |
| --- | --- | ---: |
| patient_db | patients | 5.000 |
| appointment_db | demo_reference_data | 50: 30 bác sĩ, 10 dịch vụ, 10 khoa |
| appointment_db | schedules | 1.800 |
| appointment_db | slots | 14.400 |
| pharmacy_db | inventory | 300 |
| pharmacy_db | catalog_projection | 300 snapshot thuốc DEMO |
| pharmacy_db | stock_receipts | 300 số dư kho mở đầu DEMO |
| pharmacy_db | stock_audit | 300 ghi nhận khởi tạo DEMO |

Mỗi database có thêm `demo_seed_runs` để lưu batch, cấu hình, fingerprint và kết quả
kiểm tra. Các collection kỹ thuật được bootstrap theo validator/index hiện có.

## Chạy

Tại thư mục gốc repo, cần dependency của Patient và file `env/quan.env` local:

```powershell
npm ci --prefix services/patient
node tools/quan/seed-atlas-demo.js --dry-run --start-date 2026-11-11
node tools/quan/seed-atlas-demo.js --apply --env-file env/quan.env --start-date 2026-11-11
```

Mặc định chỉ dry-run. `--apply` mới ghi dữ liệu. URI không được đưa vào đối số dòng
lệnh hoặc source; script đọc từ env local bị Git ignore. Runner chỉ chấp nhận đúng
ba host Atlas đã được Quân cấp và đúng tên database.

Bulk upsert chỉ dùng `$setOnInsert`; không xóa và không thay thế bản ghi đã có.
Chạy lại cùng tham số sẽ không thêm bản ghi trùng hoặc sửa hồ sơ/tồn kho đã thay đổi.
Đổi tham số của batch cũ bị từ chối. Dùng `--batch-id umc-ui-demo-v2` nếu muốn thêm
một bộ riêng; batch mới sẽ làm tăng dữ liệu và cần chủ động chọn số lượng phù hợp.
Nếu mạng gián đoạn, một số batch có thể đã ghi; chạy lại đúng tham số để tiếp tục.
Ba cluster không có transaction chung.

## Tìm kiếm và giới hạn tích hợp

- Hồ sơ: tìm `DEMO`, `Nguyễn`, `Minh`, mã số cuối tên hoặc số liên hệ giả lập.
- Kho: tìm `DEMO-MED-0001`, `Viên`, `Dung dịch`, `Gói`. Có hàng hết, sắp hết và còn nhiều.
- Lịch: 30 bác sĩ DEMO, ca 08:00–12:00 và 13:00–17:00, mỗi slot 30 phút.
- `demo_reference_data` cho biết ID/name bác sĩ, khoa, dịch vụ; chưa phải danh mục
  PostgreSQL do Catalog phát. Không tạo checkpoint Catalog giả hoặc outbox event.
- Snapshot thuốc có `source=DEMO_FIXTURE` và `seedBatch=umc-ui-demo-v1`, phục vụ tên/mã
  trên màn hình kho. Chúng không chứng minh đã đồng bộ stream Catalog.
- `ownerUserId`/`doctorUserId` là tham chiếu giả lập; không tự tạo tài khoản đăng nhập
  hoặc quyền Identity. Cần nguồn Identity/Catalog thật để demo luồng phân quyền đầy đủ.
- Không seed lịch hẹn PAID, thanh toán thành công, đơn FINAL hoặc phiếu cấp thuốc.
  Giữ chỗ, thanh toán, cấp thuốc phải được tạo qua luồng nghiệp vụ khi ghép backend.

Kiểm thử: `node --test tests/mongo/demo-seed.test.js` dùng replica set local tạm,
không ghi vào Atlas. Kiểm tra ID/relation/schema, cấu hình đích, chạy lại và giữ dữ liệu đã sửa.
