# Catalog

Go 1.27.0 · Echo 5.4.0 · pgx 5.11.0 · PostgreSQL 18 · Hexagonal Architecture.
Sáu HTTP operation CA-001–006, CatalogChanged v1 snapshot/checkpoint stream, RabbitMQ outbox publisher và bounded Redis cache-aside cho GET đều có implementation. Clinical và Diagnostic cũng có luồng nghiệp vụ riêng; xem từng service README và contract integration để biết giới hạn nối Appointment/Billing/Gateway còn lại.

## Dữ liệu online

Tạo `env/huy.env` từ mẫu. `CATALOG_DATABASE_URL` phải trỏ đúng `catalog_db` trên Neon với `sslmode=require`. Chạy migration trước API; chỉ seed sau khi Huy đã thống nhất dữ liệu demo trên database chung. Nạp `DATABASE_URL` từ file thật vào tiến trình Catalog, rồi khởi chạy migrate, API và worker. Kiểm HTTP qua Gateway của Quân.

```powershell
./tools/huy/go.ps1 -Service catalog run ./cmd/migrate
./tools/huy/go.ps1 -Service catalog run ./cmd/api
```

Đặt public key JWT cùng cặp với Identity cho protected API. Không in DSN chứa mật khẩu vào log.

## Redis của Catalog

Catalog có Redis cache-aside cho GET. Quân quản lý một `UMC_REDIS_URL` online; Compose truyền URL này vào runtime Catalog dưới tên `REDIS_URL` và Appointment dưới tên `APPOINTMENT_REDIS_URL`. Catalog dùng `rediss://` với TLS và namespace khóa `umc:catalog:v1:*`; Appointment dùng namespace riêng.

Trước demo, xác nhận cùng tài khoản Redis có quyền trên cả hai namespace và kiểm cache hit/fallback. Khi Redis lỗi, GET fallback sang PostgreSQL theo giới hạn đã định nghĩa trong phần API bên dưới.

Trên Linux/macOS chạy Go trực tiếp trong `services/catalog`. Khi triển khai container, đặt `LISTEN_ADDR=:8007`; Gateway là điểm truy cập HTTP chung.

Public không cần Identity. Protected không có JWT config thì fail closed: thiếu bearer → 401, có bearer nhưng verifier chưa cấu hình → 503. Không có auth bypass. Xem `contracts/http/catalog-integration.md` để cấu hình key/lease và đối chiếu với Hưng trước tích hợp.

## API và quy tắc

Contract chạy bằng máy: `contracts/http/catalog.openapi.json` (OpenAPI 3.1.1). Nguồn baseline: API86 CSV v5.2 và ERD v5. Không thay file tài liệu gốc.

| Mã | Method/path | Quyền |
| --- | --- | --- |
| CA-001 | GET `/api/v1/departments` | Public |
| CA-002 | GET `/api/v1/doctors` | Public; departmentId/page/limit |
| CA-003 | GET `/api/v1/medical-services` | Public; departmentId/at |
| CA-004 | POST `/api/v1/prices` | STAFF ADMIN + lease CA-004 + UUID Idempotency-Key |
| CA-005 | GET `/api/v1/catalog/medicines` | DOCTOR; STAFF PHARMACY/ADMIN |
| CA-006 | GET `/api/v1/catalog/lab-tests` | DOCTOR; STAFF LAB_TECH/LAB_REVIEW/ADMIN |

Response `{data,meta:{correlationId}}`; lỗi `{error:{code,message},meta:{correlationId}}`. CA-005/006 `data` là array; ba GET public trả `data.items`, riêng doctors có `data.total`. Không thêm q cho doctors khi chưa đổi baseline.

- Price VND nguyên không âm, immutable, thời điểm mới >= now + 5 phút; độ chính xác tối đa microsecond (phần lẻ giây tối đa 6 chữ số có nghĩa), vượt độ chính xác trả 400 trước khi ghi DB. Khoảng `[effectiveFrom,effectiveTo)`; null/missing end = vô hạn. Không tự cắt khoảng giá cũ. Trùng → 409 `OVERLAPPING_PRICE_PERIOD`; item không tồn tại/inactive → 400.
- Mỗi cặp type/item khóa trước khi tính revision và ghi. DB exclusion constraint bảo vệ giá không chồng. Cùng actor/key/body chuẩn hóa UTC trả lại bản 201 cũ; actor/key UUID được chuẩn hóa hoa/thường khi khóa; đổi body với key cũ → 409 `IDEMPOTENCY_CONFLICT`.
- Chưa có giá hiệu lực → `price:null`, không phải giá 0. Giá Catalog chỉ để hiển thị, Billing chốt quote/snapshot sau.
- Seed dữ liệu học tập có ID cố định, không phải bác sĩ/bệnh nhân thật. Giá seed hữu hạn: từ đầu ngày hôm qua đến đầu ngày sau 2 ngày; chạy seed lại không ghi đè lịch sử hoặc quyền đã đổi. Khi demo ngoài cửa sổ đó cần tạo phiên bản tương lai hợp lệ bằng ADMIN, không sửa lịch sử.
- Cache-aside dùng khóa `umc:catalog:v1:{generation}:{filterHash}`, TTL 60 giây ±10% jitter và tối đa dừng trước mốc đổi giá. Cache không lưu quyền truy cập; mỗi request thuốc/xét nghiệm xác minh quyền trước khi đọc cache. Redis timeout 100 ms; circuit breaker mở 15 giây sau ba lỗi; fallback PostgreSQL giới hạn 10 request đồng thời.
- Khi tạo giá thành công, generation cache đổi sau commit. Nếu Redis vắng mặt/lỗi, GET dùng giới hạn fallback; vượt giới hạn trả 503. Chạy native không cấu hình Redis sẽ dùng PostgreSQL trực tiếp.
- `/health/live` chỉ kiểm process; `/health/ready` kiểm kết nối/schema Catalog. Không yêu cầu broker cho GET. Clinical/Diagnostic readiness mới kiểm own DB connectivity.

## Cấu trúc code

`domain` chứa kiểu/quy tắc; `application/ports` chứa inbound/output port trung lập; `application/usecase` điều phối; `adapters/inbound/http` là Echo/JWT; `adapters/outbound/postgres` là pgx/transaction; `cmd` ghép dependency. Không import driver/framework vào lõi, không đọc DB service khác.

Migration hiện có hai version (`000001_catalog`, `000002_catalog_stream`) với ledger, transaction và advisory lock; đây là runner nhỏ theo dự án, không phải framework migration đầy đủ. Khi thêm version tiếp theo phải kiểm upgrade từ version 2, không sửa file đã áp dụng.

## Kiểm thử

Từ repo (mỗi lệnh Go cho một service):

```powershell
.\tools\huy\go.ps1 -Service catalog test -count=1 ./...
.\tools\huy\go.ps1 -Service catalog vet ./...
.\tools\huy\go.ps1 -Service catalog build ./...
python tools/huy/test_postgres.py
python -m pip install -r tools/huy/contract-requirements.txt
python tools/huy/check_catalog_contract.py .runtime/catalog-http-responses.json
python tools/huy/check_architecture.py
```

`test_postgres.py` dùng PostgreSQL 18 native Windows mặc định; override `PG_BIN`, `GO_BIN`, `HUY_TEST_PG_PORT` khi cần. Nó chỉ init cluster test trong `.runtime/postgres-tests`, bind loopback 55439, tạo/xóa DB tên `umc_huy_test_<random>`, rồi dừng cluster nếu tác vụ đã khởi động. Không dùng service PG đang có. Trust auth chỉ dành cluster test không chứa dữ liệu thật; không triển khai cấu hình này.

Linux/CI có PostgreSQL riêng: set `TEST_DATABASE_URL` vào DB bắt đầu `umc_huy_test`, chạy `go test -tags=integration -count=1 -v ./internal/adapters/outbound/postgres`. Test không tự skip nếu thiếu DB. Unit test thường không được tính thay integration. Bộ DB test chứng minh seed lặp, nullable giá, concurrent key/overlap, rollback khi outbox lỗi, quyền bị thu hồi và cả 6 route qua RSA JWT thật trong fixture test. File response test thật dùng cho JSON Schema validation.

Web feature và preview: `apps/web/src/features/catalog/README.md`, `tools/catalog-preview/README.md`. CI definition trong `.github/workflows/huy-go.yml`; xem kết quả của commit trên GitHub để biết job đã chạy hay chưa.
