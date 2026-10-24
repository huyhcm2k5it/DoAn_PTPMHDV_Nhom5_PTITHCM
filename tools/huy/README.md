# Điểm bắt đầu cho Huy

Nhánh làm việc: `huy`, tạo từ `develop`. Phạm vi code tuần 22–25/10: Catalog CA-001–006 + W03, nền Echo/Hexagonal cho Clinical và Diagnostic. Tích hợp vào `develop` theo yêu cầu của nhóm.

1. Đọc `services/catalog/README.md`: DB, migrate, seed, API, lệnh chạy/test.
2. Xem `contracts/http/catalog.openapi.json` và `catalog-integration.md`: schema/claim/quyền/seed ID/điểm nối còn chờ.
3. Chạy `tools/catalog-preview` để xem W03 trên API thật. Khi ghép shell, dùng feature `apps/web/src/features/catalog`; giữ owner phần chung Quân/Hưng.
4. Clinical/Diagnostic có health và DB adapter, chưa có nghiệp vụ. Tiếp tục use case tuần sau trong lõi, không đưa Echo/pgx vào domain/application.

`go.ps1` đặt Go cache/temp trong `.runtime`. `test_postgres.py` tạo cluster/DB test riêng trên Windows; không dùng database hiện có. `check_architecture.py` kiểm hướng import; `check_catalog_contract.py` kiểm OpenAPI và response thật. `generate_catalog_contract.py` tái sinh JSON contract khi contract đã được duyệt thay đổi.

Kết quả kiểm thử, review, quyết định và giới hạn tích hợp: `tools/huy/VERIFICATION.md`. Không có Gateway tạm hoặc auth bypass để giả lập tích hợp thành công. Không sửa các Word/PDF tài liệu gốc trong lần code này.
