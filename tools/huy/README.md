# Điểm bắt đầu cho Huy

Nhánh làm việc là `huy_task`, đồng bộ từ `develop`. Huy phụ trách Catalog, Clinical và Diagnostic, gồm HTTP API, PostgreSQL, cache Catalog, worker RabbitMQ và hợp đồng giao tiếp.

1. Đọc `services/catalog/README.md`: DB, migrate, seed, API, lệnh chạy/test.
2. Xem `contracts/http/catalog.openapi.json` và `catalog-integration.md`: schema/claim/quyền/seed ID/điểm nối còn chờ.
3. Chạy `tools/catalog-preview` để xem W03 trên API thật. Khi ghép shell, dùng feature `apps/web/src/features/catalog`; giữ owner phần chung Quân/Hưng.
4. Clinical đã có nhận lượt, ghi nháp, chỉ định LAB, toa, ký khám và đọc lịch sử. Diagnostic có thanh toán LAB, mẫu, kết quả, duyệt, công bố, hủy và nhận trạng thái hoàn. Đọc `contracts/http/clinical-integration.md` và `diagnostic-integration.md` trước khi nối frontend.

Ba file env thật nằm trong `env/`. API và worker dùng đúng DB của service. RabbitMQ và Redis dùng endpoint online chung của Quân. JWT dùng public key tương ứng với Identity. Các entrypoint `cmd/migrate` áp schema trước khi chạy API/worker.

Các bài `TestGroupCatalogDataAndLegacyUpgrade`, `TestGroupClinicalDataRoundTrip` và `TestGroupDiagnosticDataRoundTrip` đọc dữ liệu nhóm ở `docs/umc-care-demo-data.json` và kiểm tra lưu/đọc trên PostgreSQL riêng. Kịch bản lịch sử trong file dùng ngày 10/11/2026. Để demo đặt lịch hiện tại, Appointment phải cung cấp lịch và vé hiện hành qua giao diện của owner.

`go.ps1` đặt Go cache/temp trong `.runtime`. `test_postgres.py` tạo cluster/DB test riêng trên Windows; không dùng database hiện có. `check_architecture.py` kiểm hướng import; `check_catalog_contract.py` kiểm OpenAPI và response thật. `generate_catalog_contract.py` tái sinh JSON contract khi contract đã được duyệt thay đổi.

Kết quả kiểm thử, review, quyết định và giới hạn tích hợp: `tools/huy/VERIFICATION.md`. Không có Gateway tạm hoặc auth bypass để giả lập tích hợp thành công. Không sửa các Word/PDF tài liệu gốc trong lần code này.
