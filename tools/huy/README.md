# Điểm bắt đầu cho Huy

Nhánh làm việc là `huy_task`, đồng bộ từ `develop`. Huy phụ trách Catalog, Clinical và Diagnostic, gồm HTTP API, PostgreSQL, Redis cho cả ba service, worker RabbitMQ và hợp đồng giao tiếp.

1. Đọc `services/catalog/README.md`: DB online, schema migration, API, lệnh chạy/test.
2. Xem `contracts/http/catalog.openapi.json` và `catalog-integration.md`: schema/claim/quyền/ID từ dữ liệu online/điểm nối còn chờ.
3. Chạy web tại `apps/web` qua Gateway. Các màn Catalog, Clinical và Diagnostic dùng chung phiên đăng nhập, router và runner kiểm thử của web.
4. Clinical đã có nhận lượt, ghi nháp, chỉ định LAB, toa, ký khám và đọc lịch sử. Diagnostic có thanh toán LAB, mẫu, kết quả, duyệt, công bố, hủy và nhận trạng thái hoàn. Đọc `contracts/http/clinical-integration.md` và `diagnostic-integration.md` trước khi nối frontend.

Ba file env thật nằm trong `env/`. API và worker dùng đúng DB của service. RabbitMQ và Redis dùng endpoint online chung của Quân. JWT dùng public key tương ứng với Identity. Trong Compose, API tự áp schema trước readiness; `cmd/migrate` phục vụ tác vụ vận hành thủ công.

Các bài `TestGroupCatalogDataAndLegacyUpgrade`, `TestGroupClinicalDataRoundTrip` và `TestGroupDiagnosticDataRoundTrip` đọc dữ liệu nhóm ở `docs/umc-care-demo-data.json` và kiểm tra lưu/đọc trên PostgreSQL riêng. Kịch bản lịch sử trong file dùng ngày 10/11/2026. Để demo đặt lịch hiện tại, Appointment phải cung cấp lịch và vé hiện hành qua giao diện của owner.

`go.ps1` đặt Go cache/temp trong `.runtime`. `test_postgres.py` tạo cluster/DB test riêng trên Windows; không dùng database hiện có. `check_architecture.py` kiểm hướng import; `check_catalog_contract.py` kiểm OpenAPI và response thật. `generate_catalog_contract.py` tái sinh JSON contract khi contract đã được duyệt thay đổi.

## Chạy đúng project của nhóm

Dùng [hướng dẫn Docker chung](../../infra/compose/README.md), đúng ba file env hiện có. Không dùng launcher test riêng cho lượt nghiệm thu này. Web ở http://127.0.0.1:15173; Gateway theo env Quân. API Huy áp migration trước readiness, rồi mới bật worker. PostgreSQL, MongoDB, RabbitMQ và Redis đều dùng endpoint online của nhóm; JWT dùng cặp khóa đang có.

## Khi chuẩn bị triển khai online

Image Clinical có sẵn `/visit-grant` cho tác vụ đồng bộ lại quyền bác sĩ trên lượt khám đã được owner xác minh. Công cụ dùng `DATABASE_URL` của Clinical, yêu cầu xác nhận bằng `-apply` và ghi event vào outbox để worker phát. Trong Compose, mỗi API Huy tự chạy migration trước readiness; worker chỉ khởi động sau khi API healthy. `/migrate` chỉ là lệnh vận hành một lần trong image API; Compose không giữ service migrate riêng.

Với hướng EC2 và Vercel, backend chạy sau Gateway HTTPS. Web gọi đường dẫn tương đối `/api/v1`, nên cấu hình triển khai web phải chuyển `/api/v1/*` tới Gateway. `HQH_GATEWAY_URL` của Vite cấu hình proxy của Vite khi phát triển. Cấu hình DB, RabbitMQ, Redis và khóa triển khai nằm ở môi trường backend.

Xem `tools/huy/VERIFICATION.md` để đối chiếu các đợt kiểm thử backend trước đó.

## Runtime không có seed giả

Catalog không còn cờ -seed hoặc migrations/seed.sql; Clinical không còn -seed-demo/SeedDemo. Migration chỉ áp schema. Fixture SQL của Catalog chỉ embed trong file integration_test.go và không vào binary. Import projection vẫn giữ vì nhận snapshot owner có căn cứ, không thay bằng dữ liệu tự tạo. Các bài test fixture không là cách nạp dữ liệu vào Neon.
