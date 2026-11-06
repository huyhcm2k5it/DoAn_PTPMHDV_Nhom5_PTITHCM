# Catalog

Go 1.27.0 · Echo 5.4.0 · pgx 5.11.0 · PostgreSQL 18 · Hexagonal Architecture.
Sáu HTTP operation CA-001–006, CatalogChanged v1 snapshot/checkpoint stream, RabbitMQ outbox publisher và bounded Redis cache-aside cho GET đều có implementation. Clinical và Diagnostic cũng có luồng nghiệp vụ riêng; xem từng service README và contract integration để biết giới hạn nối Appointment/Billing/Gateway còn lại.

## Chạy với Compose riêng của Catalog

Từ gốc repo, copy `infra/compose/huy.env.example` sang `infra/compose/.env.local`, điền năm password khác nhau (ký tự URL-safe). Cần Docker engine chạy:

```powershell
docker compose --env-file infra/compose/.env.local -f infra/compose/huy.catalog.yml up --build -d
# Seed chỉ dành cho demo, chạy chủ động sau migration:
docker compose --env-file infra/compose/.env.local -f infra/compose/huy.catalog.yml run --rm catalog-migrate -seed
Invoke-RestMethod http://127.0.0.1:8081/health/ready
Invoke-RestMethod http://127.0.0.1:8081/api/v1/medical-services
```

Compose bind API/DB/Redis vào loopback. Redis giới hạn 128 MiB với `allkeys-lru`; ACL giới hạn user Catalog vào prefix `umc:catalog:v1:*`. Không mở rộng init script sang DB có sẵn. Không xóa volume để sửa migration.

## Chạy Go native

Tạo một DB riêng thuộc Catalog, set `DATABASE_URL` theo `.env.example`; không dùng DB service khác. Từ repo:

```powershell
$env:DATABASE_URL='postgres://catalog_owner:YOUR_URL_SAFE_PASSWORD@127.0.0.1:55432/catalog_db?sslmode=disable'
# Redis là tùy chọn khi chạy native; thiếu REDIS_ADDR thì cache bị tắt.
$env:REDIS_ADDR='127.0.0.1:56379'
$env:REDIS_USERNAME='default'
$env:REDIS_PASSWORD='YOUR_CATALOG_REDIS_PASSWORD'
.\tools\huy\go.ps1 -Service catalog run ./cmd/migrate -seed
.\tools\huy\go.ps1 -Service catalog run ./cmd/api
```

Helper đặt cache/temp vào `.runtime/` để tránh lỗi quyền Windows. Trên Linux/macOS chạy Go trực tiếp trong `services/catalog`. API mặc định chỉ nghe `127.0.0.1:8081`; container dùng `LISTEN_ADDR=:8081`.

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

Web feature và preview: `apps/web/src/features/catalog/README.md`, `tools/catalog-preview/README.md`. CI definition trong `.github/workflows/huy-go.yml`; chưa chạy trên GitHub vì chưa push.
