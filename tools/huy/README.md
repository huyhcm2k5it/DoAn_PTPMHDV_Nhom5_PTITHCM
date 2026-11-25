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

## Phục hồi projection quyền bác sĩ Diagnostic

Khi Diagnostic bị gap stream, dùng `services/diagnostic/cmd/recover-visit-grants` theo quyền operator Huy. Công cụ chỉ đọc nguồn Clinical bằng transaction repeatable-read/read-only, yêu cầu mọi lượt đều có grant tường minh, giữ nguyên cả quyền đã thu hồi và quyền hủy của lượt đã ký. Target chỉ ghi `objects` cho grant, metadata version và watermark trong cùng transaction khóa `diagnostic:business`. Không ghi bảng nghiệp vụ, inbox hoặc DLQ.

Nạp `CLINICAL_DATABASE_URL` và `DIAGNOSTIC_DATABASE_URL` từ env Huy hiện có vào môi trường tiến trình. Tại `services/diagnostic`, chạy `go run ./cmd/recover-visit-grants` để dry-run; chỉ thêm `-apply` khi đã kiểm kết quả và được phép phục hồi projection shared. Công cụ từ chối sai database, snapshot thiếu quyền, watermark lùi/đã có gap mới hơn hoặc snapshot quá hạn. Không cấp DSN Clinical cho API/worker Diagnostic; đây là lệnh operator riêng, không có HTTP endpoint hoặc worker mới. Image Diagnostic có binary `/recover-visit-grants` sau khi build lại.

Sau recovery, phải kiểm checkpoint mới tiếp tục đến, Last bắt kịp GapThrough và checkpoint chưa quá 30 giây, rồi thử đúng/sai bác sĩ và quyền đã thu hồi. Snapshot không thay thế việc xử lý backlog RabbitMQ. Không bỏ guard hoặc tự điền timestamp mới để làm health giả. Các checkpoint backlog hoặc DLQ chỉ được xử lý theo quy trình đã được duyệt; giữ bằng chứng nguồn và trạng thái nghiệp vụ.

## Độ bền stream Catalog và lỗi Gateway

Publisher Catalog chạy độc lập với consumer Identity, dùng một publisher duy nhất và join khi shutdown trước khi đóng channel. Bootstrap chỉ chạy lại nếu chưa thành công; checkpoint được kiểm theo nhịp 10 giây bằng thời gian thực lúc tick. Lỗi broker giữ event đầu stream PENDING và backoff 5/15/60 giây (capped 60), không chuyển FAILED rồi vượt qua sequence. Channel publisher đóng sẽ kết thúc lượt worker để cơ chế restart kết nối lại. Không tự gộp, bỏ qua hoặc xóa checkpoint cũ.

Ba adapter FE Huy giữ mã lỗi nghiệp vụ từ JSON. Với phản hồi text của Gateway, 401/403/5xx lần lượt được thể hiện là UNAUTHENTICATED/FORBIDDEN/SERVICE_UNAVAILABLE và giữ X-Correlation-ID khi có. HTTP 2xx thiếu data vẫn là INVALID_RESPONSE; không đổi lỗi kết nối thành dữ liệu demo hoặc danh sách trống.
