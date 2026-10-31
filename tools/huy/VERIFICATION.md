# Kiểm chứng bàn giao Catalog và Clinical

## Clinical tuần 2 — 31/10/2026

Đã triển khai CL-001–004, migration PostgreSQL, xử lý ClaimQueueTicket/QueueTicketClaimed, projection quyền, outbox/inbox/retry/quarantine và feature bàn khám. [README Clinical](../../services/clinical/README.md) ghi lệnh chạy; [hợp đồng bàn giao](../../contracts/http/clinical-integration.md) ghi ranh giới cần ghép với Quân/Hưng.

| Kiểm tra đã chạy | Kết quả |
| --- | --- |
| `go test -count=1 ./...`, `go vet ./...`, `go build ./...` trong Clinical | PASS |
| `python tools/huy/test_clinical_postgres.py` | PASS 7 test với PostgreSQL 18 thật, database test riêng được dọn sau chạy |
| HTTP dùng RSA JWT thật và PostgreSQL; kiểm phản hồi bằng OpenAPI | PASS cả 4 operation và error envelope |
| `npm test`, `npm run build` trong `tools/clinical-preview` | PASS 8 test và build TypeScript/Vite |
| Sinh lại contract và so hash; kiểm YAML workflow | PASS, không có contract drift |
| Guard hướng import domain/application | PASS |
| Compile test tag `brokerintegration` | PASS; không tính là đã chạy broker thật |

Các ca quan trọng gồm: start PENDING chưa tạo visit; 8 delivery claim lặp chỉ một visit; RETURN dùng lại visit; claim REJECTED không tạo visit; 6 writer cùng version chỉ một bản nháp được ghi; rollback khi outbox lỗi; bệnh nhân không đọc nháp; thu hồi quyền; cùng UUID khác chữ hoa/thường nhập lại không xung đột; message đã RETRY_SCHEDULED không chạy lại từ delivery gốc.

Review độc lập tìm 2 lỗi P2: giữ ý định nhận vé cũ sau lỗi 409 và delivery gốc vượt lịch retry. Đã có test tái hiện FAIL rồi PASS cho cả hai. Giao diện cũng giữ nguyên body/key khi lỗi mạng chưa xác định kết quả và giữ nháp khi nhận 409.

**Giới hạn tích hợp:** Docker daemon local chưa sẵn sàng, nên chưa chạy RabbitMQ/Compose thật. CI đã có broker integration job nhưng chỉ được tính PASS khi có kết quả trên commit GitHub. Feed vé đáng tin cậy của Appointment, consumer claim, shared shell và Gateway/Identity live cần Quân/Hưng ghép và kiểm. Importer vé là đầu nối nội bộ tạm thời, thiếu dữ liệu thì API chặn; không tạo claim thành công giả. Clinical phân biệt doctorId của Catalog với doctorUserId của JWT qua projection đã xác thực.

Log và response fixture local nằm trong `.runtime/clinical-postgres-integration.log` và `.runtime/clinical-http-responses.json`, không đưa vào Git. Phần dưới lưu bằng chứng Catalog trước đây theo đúng thời điểm chạy.

## Catalog — kiểm chứng ngày 22/10/2026

**Cập nhật 24/10/2026:** Huy đã yêu cầu commit, đẩy nhánh `huy` và gộp vào `develop`. Các ghi chú “chưa commit/push” bên dưới mô tả trạng thái tại lượt kiểm chứng ngày 22/10. Trước lần tích hợp này, đã chạy lại Go vet/test/build cả ba service, 13 test web + build và test PostgreSQL thật; trạng thái Git sau tích hợp xem trong lịch sử repository.

Nhánh `huy`, base `develop` commit `9ab152e97748e4395e721fe3c5cc46d9faf4a56e`. Source đang nằm trong working tree, **chưa commit/push**. Các tài liệu Word có sẵn được giữ nguyên. Không triển khai Gateway hoặc sửa code service của thành viên khác.

## Đã chạy thật

| Kiểm tra | Kết quả |
| --- | --- |
| Go vet, unit tests, build riêng Catalog/Clinical/Diagnostic | PASS cả ba module |
| PostgreSQL 18 native, DB/cluster test riêng | PASS; migration, seed chạy lặp, giá null, concurrent create/overlap, rollback khi outbox lỗi, revoke quyền |
| Cả 6 HTTP operation qua Echo + PostgreSQL + RSA JWT/lease test | PASS; public/protected/400/401/403/201/replay |
| UUID key/actor khác chữ hoa/thường; body khác nhưng cùng UUID key | PASS với barrier khóa row để tái hiện race thật |
| Timestamp giá sub-microsecond | Trả 400 trước persistence; read-back/boundary microsecond đúng |
| OpenAPI 3.1.1, 6 operationId, request hợp lệ + 5 request sai | PASS |
| Schema của 6 response HTTP thật + error envelope | PASS |
| React/Vitest | 13 test PASS; loading/empty/error/401/403, stale request, quyền, callback, money/time validation, double submit, giữ key khi retry/đổi transport/qua mốc hiệu lực |
| TypeScript + Vite production build | PASS |
| npm ci theo lockfile | PASS; audit tại thời điểm chạy không báo vulnerability |
| Hexagonal import direction; Go fmt; Prettier | PASS |
| Binary API Linux amd64, CGO=0 | Cả ba đã build thành công; Docker image/runtime chưa được kiểm bằng kết quả này |
| Compose config | PASS; không tạo container |
| Workflow YAML và ví dụ role/DSN | Đã kiểm; CI có job DB thật và kiểm response theo schema |

Lệnh chạy lại nằm trong `services/catalog/README.md` và `tools/catalog-preview/README.md`. Log tạm trong `.runtime/postgres-integration.log`; response test thật `.runtime/catalog-http-responses.json`. Đây là dữ liệu test, không commit. Test DB đã được xóa và cluster do tác vụ khởi động đã dừng.

## Review và sửa

Đã có một lượt review toàn bộ source trong context độc lập, chỉ đọc. Reviewer tìm ba lỗi Important, ba lỗi ban đầu xếp Minor; không có Critical. Author đánh giá lại tác động thực tế và sửa trong một lượt:

1. Đổi lease/transport làm unmount form, mất body/key/success: test qua CatalogPage đã tái hiện FAIL, sửa rồi PASS. Preview dùng transport ổn định, lấy credential mới nhất; đổi subject sẽ reset feature.
2. Retry nguyên request sau mốc 5 phút bị chặn tại UI: hai case đã/ chưa tới server tái hiện FAIL → PASS. Giữ key và cho server kiểm replay; body mới vẫn phải thỏa điều kiện tương lai.
3. UUID hoa/thường bypass advisory lock: ba case đồng thời tái hiện overlap/unique error → chuẩn hóa lock ID → PASS.
4. Precision gây 503/khác thời gian lưu: nâng Important vì ảnh hưởng hợp đồng ghi giá; domain tests from/to FAIL → PASS khi trả validation 400. HTTP/DB boundary kiểm thêm.
5. Ví dụ DSN dùng role không được tạo: nâng Important vì ngăn chạy native theo hướng dẫn; sửa khớp local init và so lại cả ba role.
6. CI thiếu kiểm response thật: nâng Important vì nhóm dựa vào contract gate để ghép service; thêm emit/validate fixtures trong job integration, dùng cùng lệnh đã PASS local.

Không còn finding đã biết trong lượt review bị bỏ lại chưa xử lý. Không có lượt review thứ hai; các sửa được kiểm bằng test/lệnh thực tế. Điều này không có nghĩa toàn hệ thống đã tích hợp hoặc được chứng nhận chạy production.

## Các quyết định triển khai và tác động

- Làm trong checkout hiện tại trên đúng nhánh user yêu cầu `huy`, giữ local. Không tạo worktree khác. Tác động: source chưa commit đi cùng working tree; xem `git status` trước khi đổi branch. Không merge/push nếu chưa có yêu cầu.
- OpenAPI dùng JSON thay tên YAML trong draft plan. Cùng chuẩn 3.1.1; tác động nếu nhóm trỏ file YAML cũ: cập nhật đường dẫn tool/owner handoff.
- Giá dùng khoảng `[từ,đến)`, không tự cắt giá cũ, không có giá trả null; timestamp ghi giá giới hạn microsecond. Tác động: ADMIN phải chọn khoảng không chồng; client có timestamp chính xác hơn cần giảm precision trước khi gửi.
- Claim/header JWT/lease là contract nối tạm được mô tả trong `catalog-integration.md`; xác minh chữ ký và quyền fail closed. Tác động: Hưng cần thống nhất key/issuer/audience/lease/projection trước khi demo protected live.
- W03 là feature inject vào shell/client, preview riêng chỉ dành phát triển. Tác động: owner phải ghép route/callback/shared transport, không dùng panel token preview làm login sản phẩm.
- Gateway, Identity live, shell và projection delivery là gate tích hợp bên ngoài phạm vi code độc lập đã được user cho phép. Tác động: chưa chứng minh login → hồ sơ → danh mục → slot.
- RabbitMQ worker/inbox/checkpoint/Redis và nghiệp vụ Clinical/Diagnostic giữ lịch các tuần sau. Tác động: outbox vẫn PENDING, health không chứng minh xong khám/LAB. Chưa có consumer nhận giá thật.
- Docker runtime, GitHub CI online, viewport/keyboard trên browser chưa chạy; reviewer cũng không chạy lại test trong review chỉ đọc. Tác động: cần kiểm trên môi trường ghép trước demo; kết quả local ở trên do author thực thi, không được thay cho các gate chưa chạy.

## Chưa thể tính hoàn tất tích hợp tuần

Docker engine phải hoạt động để thử build/start Compose. Nhóm phải ghép Gateway/Identity/shell/client và demo luồng liên service. Kiểm browser thực tế 360/768/1440px, điều hướng bàn phím và CI online sau khi được phép push. Không có nhánh/code nào được đưa lên GitHub trong lần này.
