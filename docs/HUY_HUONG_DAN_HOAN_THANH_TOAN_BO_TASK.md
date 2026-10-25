# Hướng dẫn hoàn thành toàn bộ task của Huy trong UMC Care

> Dành cho Huy làm lần lượt đến khi hoàn tất phần được phân công. Không chia theo ngày, thứ hoặc tuần. Bản hướng dẫn lập ngày 25/10/2026 từ source và tài liệu trong repository.
>
> Đây là checklist triển khai và nghiệm thu, không phải báo cáo phần mềm đã hoàn thành. Các ô chưa đánh dấu phải có bằng chứng trước khi chuyển thành Done.

**Mục tiêu:** hoàn thành Catalog, Clinical, Diagnostic; web W03/W08/W10/W12; bàn giao tích hợp cho Quân/Hưng; kiểm thử, CI, báo cáo và bản nộp thuộc trách nhiệm Huy.

**Kiến trúc:** mỗi service sở hữu PostgreSQL riêng; HTTP đi từ client qua Envoy đến một owner. Nghiệp vụ liên service dùng RabbitMQ với transaction cục bộ, outbox/inbox, projection và chống xử lý trùng. Backend dùng cấu trúc Hexagonal đang có trong repo.

**Công nghệ:** Go/Echo/pgx, PostgreSQL, RabbitMQ, Redis cache; web React/TypeScript. Giữ phiên bản từ `go.mod` và lockfile, không nâng phiên bản chỉ để làm checklist này.

**Nguồn đặc tả:** BRD/SRS/UC/ERD v5, các CSV API v5.2 trong `docs/`, tài liệu Kiến trúc/Saga ngày 19/10 và quy định GitHub ngày 24/10. [Phụ lục API](HUY_PHU_LUC_30_API_VA_MESSAGE.md) chép riêng 30 API và message liên quan để tra nhanh. Nếu các nguồn mâu thuẫn, giải quyết bằng H00 trước phần code bị ảnh hưởng.

**Ghi chú cho người dùng AI:** chỉ yêu cầu thực hiện task đang chọn; đọc đặc tả cùng checklist. Nếu triển khai bằng agent, áp dụng `superpowers:executing-plans` hoặc `superpowers:subagent-driven-development` theo cách người dùng chọn. Không tự coi việc đọc tài liệu này là yêu cầu triển khai toàn bộ, push hoặc release.

## 1. Huy phải giao đủ những gì

| Nhóm | Phạm vi phải hoàn thành | Không được tính thay bằng |
| --- | --- | --- |
| Catalog | CA-001–006, giá snapshot/version, CatalogChanged, quyền và cache đọc theo SRS | Chỉ có màn preview hoặc JSON tĩnh |
| Clinical | CL-001–011; bắt đầu khám, nháp, LAB, toa, ký, hồ sơ đã ký | Health endpoint hoặc CRUD thiếu state machine |
| Diagnostic | DI-001–013; tạo order qua command, thanh toán, mẫu, kết quả, duyệt, hủy | Tự đặt order PAID trong DB để demo |
| Web | W03 danh mục, W10 bác sĩ, W12 LAB, W08 bản công bố | Postman hoặc API test chạy được |
| Tích hợp | Catalog→Appointment/Billing; queue→Clinical; LAB↔Billing; toa→Pharmacy; web/Android đọc bản công bố | Mock consumer hoặc gọi thẳng port service |
| Việc chung của Huy | PostgreSQL init/role theo phân công; CI; kiểm contract; ma trận truy vết; bằng chứng test; tổng hợp báo cáo/demo/release | Làm thay 6 service của Quân/Hưng |

Huy có **30 HTTP operations = 6 Catalog + 11 Clinical + 13 Diagnostic**. Trong đó **DI-001 là adapter phục hồi, tắt mặc định và không mở qua Gateway**. Vì vậy 29 operation thuộc đường client chuẩn của Huy; health, metrics, worker không cộng vào 30. Huy điều phối kiểm kê toàn nhóm 86 HTTP operations, 18 event, 5 command; từng owner vẫn viết và chịu trách nhiệm phần của mình.

### Hiện trạng đã đối chiếu

| Phần | Quan sát trong repo | Việc còn lại |
| --- | --- | --- |
| Catalog | Có 6 API, migration/seed, JWT/lease, unit/integration test, OpenAPI | Chốt auth live, publisher/projection/cache, ghép Gateway và shell, chạy lại nghiệm thu |
| Clinical/Diagnostic | Có `cmd/api`, Echo, PostgreSQL probe, health test | Chưa có nghiệp vụ visit/LAB; phải làm các task bên dưới |
| W03 | Có feature và runner riêng `tools/catalog-preview` | Ghép app shell/shared transport, test browser và Gateway |
| W08/W10/W12 | Các thư mục feature Clinical/Diagnostic đang là khung | Viết giao diện và test với API thật |
| Messaging | Có ghi outbox Catalog; `contracts/messages` mới có README | Schema, publisher, consumer, retry/DLQ, projection và bằng chứng tích hợp |
| CI | `huy-go.yml` chạy ba Go module, DB test Catalog và preview Catalog | Bổ sung Clinical/Diagnostic/messages/web thật và kiểm CI trên commit tích hợp |
| Test trước đây | `tools/huy/VERIFICATION.md` ghi kết quả local đã chạy | Không dùng kết quả cũ để tuyên bố bản code mới đã pass hoặc toàn hệ thống đã ghép |

### Quy tắc áp dụng cho mọi task

- Mỗi service chỉ truy cập DB của mình; ID service khác là tham chiếu logic, không FK/JOIN xuyên DB.
- `domain` và `application` không import Echo, pgx, RabbitMQ, Redis hoặc code service khác.
- API giữ method/path/param/response/error theo contract; tiền VND integer, thời gian UTC ISO 8601.
- Ghi dùng Idempotency-Key theo API: retry cùng ý định giữ key/body; khác payload cùng key trả conflict. Không để client tự chọn actor/owner/state terminal.
- `202` chỉ xác nhận đã nhận và commit request; trả `statusUrl` và `Location`, chưa phải visit/order/tiền đã hoàn tất.
- Bảo vệ quyền tại backend, kể cả khi UI đã ẩn nút. Thiếu projection/quyền chưa xác minh thì chặn thao tác nhạy cảm.
- FINAL/PUBLISHED/SIGNED bất biến theo phạm vi đặc tả. Không sửa lịch sử để làm demo đẹp.
- Không mở `.rar`; không dùng dữ liệu bệnh nhân thật; không commit secret, token, OTP, `.env` hoặc log bệnh án.
- Quy trình Git hiện hành là **`huy → develop → main`** theo tài liệu 24/10, thay các quy ước cũ trong Word. Quân review PR của Huy; thay contract cần owner consumer xác nhận.

## 2. Cách dùng checklist

Chọn một task có đủ đầu vào. Đọc API/FR liên quan, viết test cho quy tắc nghiệp vụ, triển khai, chạy test, lưu bằng chứng, review rồi tích hợp. Tối đa hai task đang làm; task bị chặn phải ghi rõ người cần bàn giao và điều kiện mở chặn.

Các file ghi **dự kiến tạo** dưới đây là đề xuất tổ chức công việc, chưa tồn tại. Trước khi tạo, kiểm tra nhánh mới nhất để nối vào implementation đã có; không tạo hai bộ code thực hiện cùng một việc.

| Hoàn thành | Task | Điều kiện bắt đầu | Đầu ra nhìn thấy được |
| --- | --- | --- | --- |
| [ ] | H00 Chốt nguồn chuẩn và các điểm thiếu contract | Không | Danh sách quyết định có owner và fixture |
| [ ] | H01 Kiểm nền chạy hiện tại | Không; sửa theo H00 nếu có thay đổi | Ba Go service chạy/test được, Catalog không hồi quy |
| [ ] | H02 Contract HTTP và message | H00 | Schema máy đọc, mẫu đúng/sai, map producer/consumer |
| [ ] | H03 DB và migration nghiệp vụ | H01/H02 phần liên quan | Clinical/Diagnostic schema và transaction được test |
| [ ] | H04 Auth và projection quyền/danh mục | H02/H03 | Chặn truy cập sai và xử lý quyền thay đổi |
| [ ] | H05 Worker bền vững | H02/H03 | Outbox/inbox/retry/replay chạy với RabbitMQ thật |
| [ ] | H06 Hoàn tất Catalog và W03 | H04/H05 | Giá được consumer nhận, W03 dùng Gateway |
| [ ] | H07 Nhận lượt và lưu khám nháp | H04/H05, queue contract của Quân | CL-001–004 + W10 phần nhận lượt/nháp |
| [ ] | H08 Toa và ký khám không LAB | H07 | CL-006–010 và luồng không LAB |
| [ ] | H09 Tạo chỉ định và order LAB | H04/H05/H07 | CL-005, CreateLabOrder, DI-001 phục hồi, DI-002–003 |
| [ ] | H10 Thanh toán LAB, mẫu và hủy | H09, Billing của Hưng | DI-004–006, DI-012 và settlement guard |
| [ ] | H11 Nhập và duyệt kết quả | H10 phần mẫu hợp lệ | DI-007–011, hai người khác nhau thực hiện |
| [ ] | H12 RETURN và hồ sơ công bố | H08/H09/H11 | CL-011, DI-013, quay lại cùng visit |
| [ ] | H13 Hoàn thiện bốn nhóm màn | Ghép dần cùng H06–H12 | W03/W08/W10/W12 đủ trạng thái và quyền |
| [ ] | H14 Bàn giao tích hợp | Bàn giao dần, chốt sau H12/H13 | Quân/Hưng chạy được bằng contract/seed thật |
| [ ] | H15 CI và kiểm thử chấp nhận | Bổ sung cùng từng task, chốt sau H14 | Contract, concurrency, restart, E2E có output |
| [ ] | H16 Đo NFR và phục hồi | H14/H15 | Số đo thực tế, thử backup/restore và lỗi dependency |
| [ ] | H17 Hồ sơ nộp và release | H00–H16 đạt | Tài liệu, bằng chứng, demo, source cùng phiên bản |

**Các điểm review dễ sót:** LAB tạo đồng thời với ký; cancel đồng thời lấy mẫu; FAILED đến trước reserve; người từng sửa revision tự duyệt; patient đọc nháp qua endpoint chi tiết dù danh sách đã lọc. Các ca này có test bắt buộc ở H08/H10/H11/H12/H15.

## 3. H00 Chốt nguồn chuẩn và điểm thiếu contract

**Mục tiêu:** các bên thống nhất cùng một hợp đồng trước khi viết phần phụ thuộc. Không cần chờ tất cả vấn đề xong mới làm phần độc lập.

**Dự kiến tạo:** `docs/implementation/huy-contract-decisions.md`, `docs/implementation/baseline-manifest.md`. Huy ghi quyết định; owner liên quan review. Không sửa Word/CSV gốc âm thầm.

- [ ] Liệt kê phiên bản BRD/SRS/UC/ERD/API và commit dùng triển khai; ghi checksum nguồn. Xác định bản schema OpenAPI/AsyncAPI đầy đủ nếu nhóm đang giữ ngoài repo: hiện phần máy đọc trong `contracts/http` mới có Catalog.
- [ ] Chốt envelope/error/auth/lease với Hưng. `catalog-integration.md` nói rõ tên claim/header hiện là nối tạm; không coi đó là hợp đồng Identity đã chạy thật.
- [ ] Chốt các điểm trong bảng sau; mỗi quyết định phải chỉ ra file sửa, fixture hợp lệ/không hợp lệ và test xác nhận.

| Điểm cần chốt | Vì sao cần | Huy phải thống nhất với ai và kết quả cần có |
| --- | --- | --- |
| `refundStatus` của DI-012 | Event BillingStatusChanged hiện chỉ liệt kê Notification consumer | Hưng: thêm/điều chỉnh projection và binding Diagnostic, mapping charge/order/refund, status/version/asOf; không tự suy REFUNDED từ CANCELLED |
| LAB request bị REJECTED/FAILED | ERD lưu FAILED và ánh xạ REJECTED; đường resubmit/hủy ý định chưa đủ rõ | Clinical/Diagnostic + nhóm: quy tắc unresolved, cách bác sĩ giải quyết và audit. Không tự cho ký vì timeout hoặc FAILED; đồng bộ API/SRS/ERD trước khi thêm thao tác |
| Dữ liệu vé trước CL-002 | HTTP nhận ticketId/doctorId/version, command cần patientId; worklist chưa có nguồn ticket projection rõ trong bảng event | Quân: contract nguồn dữ liệu được xác thực và cách UI lấy vé/version; patientId do server xác định. Nếu bổ sung projection/event phải cập nhật baseline/count, không lén thêm HTTP gọi Appointment |
| DI-001 phục hồi | Sheet tham số chỉ visitId/testCodes/key, mô tả lại yêu cầu cùng requestId/hash với command | Nhóm: mapping phục hồi đủ snapshot/identity/requestId/hash, audit, cùng handler; mặc định tắt, không tạo đường tạo order thứ hai |
| DI-013 actor | Cột quyền PATIENT/DOCTOR nhưng một câu mô tả nhắc STAFF | Nhóm chốt lại văn bản; không cấp STAFF chỉ dựa câu mô tả mâu thuẫn |
| `cancellationId` và dedupe hoàn | Tài liệu kiến trúc nêu gap ở BI-007 | Hưng/Quân: key nghiệp vụ hoàn, nơi sinh cancellationId và liên kết nguồn; Huy phát LabCancelled đúng hợp đồng |
| `DISPENSED` | SRS có nhưng enum medication_holds ERD chưa có | Quân: đồng bộ enum/migration/API/test; Huy kiểm truy vết, không tự sửa Pharmacy |
| Toa, thuốc, kết quả và snapshot | HTTP dùng medicineCode/items, DB cần medicine_id/specimen_id; tên snapshot từ client không phải dữ liệu tin cậy | Huy chốt cách resolve từ projection/mẫu hợp lệ cục bộ, chuẩn hóa/hash, trường server quyết định; đối chiếu schema đầy đủ |
| Manifest và BFF | Tài liệu kiến trúc nêu cách gọi và phiên bản chưa thống nhất | Giữ client→Gateway→owner theo baseline; ghi rõ bản chuẩn, không thêm BFF hoặc API mới khi chưa duyệt |

**Đạt khi:** từng gap ảnh hưởng task sắp làm có quyết định và mẫu payload được các owner liên quan xác nhận; gap chưa đóng ghi BLOCKED cho đúng phần. Việc chọn giải pháp chưa đồng nghĩa đã triển khai xong.

## 4. H01 Kiểm nền chạy hiện tại và phần Catalog đã có

**Đọc/sửa khi cần:** `services/{catalog,clinical,diagnostic}/README.md`, `.env.example` của từng service, `infra/compose/huy.catalog.yml`, `tools/huy/`, `tools/catalog-preview/`.

- [ ] `git status --short` trước khi đổi branch; giữ tài liệu untracked và sửa đổi của người khác. Checkout đang là `develop` tại thời điểm soạn hướng dẫn; chuyển sang `huy` chỉ khi working tree cho phép.
- [ ] Kiểm Go/Docker/PostgreSQL/Node theo cấu hình repo; chạy lại ba module và test Catalog theo mục lệnh ở cuối tài liệu.
- [ ] Khởi động Compose riêng Huy trong môi trường demo; migrate/seed Catalog; health/live và health/ready đúng ý nghĩa. Khi chỉ có DB probe, không quảng cáo readiness đã kiểm đủ schema/projection.
- [ ] Test giá null, giá không chồng, hiệu lực tương lai, replay key, revoke quyền; kiểm `.runtime` chỉ là đầu ra local.
- [ ] Ghi rõ phần chưa chạy: Docker runtime, CI online, Gateway/Identity thật, browser. Không đánh PASS thay cho công việc còn thiếu.

**Đạt khi:** có output lệnh, commit và cấu hình môi trường; Catalog không mất tính năng cũ. Nền này chưa có nghiệp vụ Clinical/Diagnostic.

## 5. H02 Chốt schema HTTP và message để các bên code khớp nhau

**Sửa:** `contracts/http/catalog.openapi.json` nếu H00 yêu cầu. **Dự kiến tạo:** `contracts/http/clinical.openapi.json`, `diagnostic.openapi.json`, `contracts/messages/envelope.schema.json`, `contracts/messages/events/`, `commands/`, `examples/`, `tools/huy/check_huy_contracts.py`.

- [ ] Đối chiếu từng API trong phụ lục: method/path, operationId đổi `-` thành `_`, auth/capability/ownership, body/query/header, response và mã lỗi.
- [ ] Với CL-002/005 định nghĩa cả response 202, Location, statusUrl, trạng thái đang chờ và GET trả kết quả/lý do từ chối. Không đòi client đoán trạng thái bằng timeout.
- [ ] Tạo JSON Schema từng message Huy sản xuất/nhận: trường bắt buộc, UUID/version/time, snapshot/hash, producer và sourceType; dùng tên trường từ baseline đã chốt.
- [ ] Viết fixture cho message hợp lệ, thiếu field, sai producer, sai revision, trùng ID khác hash và payload từ phiên bản trước được hỗ trợ.
- [ ] Ghi map exchange/routing/queue, ai publish/consume và idempotency key nghiệp vụ. Không dùng chung một queue cho Clinical và Diagnostic.
- [ ] Validator kiểm request và response thu từ API test thật; không chỉ kiểm file OpenAPI parse được.

**Đạt khi:** đủ 30 operationId đúng baseline, không tính health; message Huy dùng có schema/fixture/consumer xác nhận. Nếu H00 thay số lượng baseline phải ghi quyết định mới, không ép số đếm cũ để che thay đổi.

## 6. H03 Tạo DB nghiệp vụ và migration có thể nâng cấp

**Dự kiến tạo trong mỗi service Clinical/Diagnostic:** `migrations/0001_initial.sql`, `cmd/migrate/main.go`, `internal/adapters/outbound/postgres/migrate.go`, `transaction.go`, các repository theo aggregate, integration tests. Catalog thêm migration version tiếp theo khi cần; không sửa initial đã áp dụng.

- [ ] Clinical: `visits`, `visit_notes`, `prescriptions`, `prescription_items`, `lab_requests`, `start_requests`, `lab_status_projection` và bảng kỹ thuật theo ERD.
- [ ] Diagnostic: `lab_orders`, `specimens`, `results`, `result_items`, `reviews`, `settlement_decisions`, `command_results` và bảng kỹ thuật.
- [ ] Các service cần outbox/inbox/idempotency/retry/dead-letter/checkpoint/access projection theo trách nhiệm. Không gom tất cả vào một DB dùng chung.
- [ ] Unique bắt buộc: visits.appointment_id; lab_orders.clinical_request_id; `(visit_id, request_key)`; `(order_id, sequence)`; barcode; `(order_id, revision)` của result; `(visit_id, revision)` của toa. Tối đa một toa FINAL hiệu lực theo visit.
- [ ] Foreign key chỉ trong DB cùng owner. Check quantity > 0; snapshot tiền integer; version và fence có điều kiện cập nhật chống mất ghi.
- [ ] Một transaction bao gồm state + idempotency/inbox + outbox cần thiết. Ép insert outbox lỗi để chứng minh toàn bộ transaction rollback.
- [ ] Test migrate DB rỗng, chạy lại, nâng từ schema cũ, seed chạy lại không nhân đôi và rollback lỗi. Dùng PostgreSQL thật cho race/unique/transaction.
- [ ] Huy phối hợp owner PostgreSQL để đủ sáu DB/role theo Compose chung; test tài khoản service không đọc được DB khác. Compose riêng hiện chỉ dựng ba DB Huy, không gọi đó là môi trường đủ chín service.

**Đạt khi:** migration chạy độc lập, có ledger/version, không sửa dữ liệu lịch sử, test invariant trên DB thật đạt. README ghi lệnh migrate/seed thực sự đã chạy.

## 7. H04 Quyền và projection cục bộ

**Dự kiến tạo:** mỗi service `internal/application/ports/authorization.go`, `internal/application/usecase/authorization.go`, `internal/adapters/inbound/http/auth.go`, adapter projection PostgreSQL và test; tận dụng cách tổ chức Catalog, không import implementation giữa service.

- [ ] Xác minh JWT theo issuer/audience/key/expiry/tokenVersion đã chốt với Hưng; phân biệt userId, doctorId và patientId.
- [ ] Nhận IdentityAccessChanged, PatientAccessChanged và CatalogChanged đúng service; cập nhật version đơn điệu. Event cũ không ghi đè event mới.
- [ ] Seed/bootstrap projection từ export của owner có checksum/watermark; replay sau watermark; thiếu checkpoint/điều kiện quyền thì chặn write theo contract. Không SELECT DB Identity/Patient/Catalog để bổ sung thiếu dữ liệu.
- [ ] Bác sĩ chỉ thao tác hồ sơ/phạm vi được cấp; bệnh nhân chỉ hồ sơ của mình. STAFF phải có LAB_TECH hoặc LAB_REVIEW đúng thao tác; một actor STAFF không tự có mọi quyền.
- [ ] Lease cho hành động nhạy cảm theo policy đã chốt, hạn tối đa 30 giây. Test token còn hạn nhưng quyền đã thu hồi; lease hết hạn khi event quyền bị trễ.
- [ ] Kiểm cả đường GET danh sách, GET chi tiết, thao tác POST/PUT/DELETE và polling operationId. Thay ID trong URL không vượt ownership.
- [ ] Log correlationId và mã quyết định; không log token, OTP, nội dung khám hoặc kết quả LAB.

**Đạt khi:** test 401/403/503, cross-patient, cross-doctor, capability, projection missing/stale và revoke chạy qua middleware thật. Không dùng mock quyền để tuyên bố auth tích hợp.

## 8. H05 Publisher consumer retry và phục hồi message

**Dự kiến tạo trong service cần dùng:** `cmd/worker/main.go`, `internal/application/usecase/messages.go`, `internal/adapters/inbound/amqp/consumer.go`, `internal/adapters/outbound/amqp/publisher.go`, `internal/adapters/outbound/postgres/outbox.go`, `inbox.go`, `retry.go`. Runtime broker/ACL/binding phối hợp Quân.

- [ ] Publisher lấy batch bằng lease DB, gửi persistent message tới durable exchange/queue, bật confirms và mandatory. Nack/timeout/basic.return giữ PENDING để retry; confirm không có nghĩa consumer đã xử lý.
- [ ] Consumer kiểm schema, producer/exchange và allowlist type/source trước nghiệp vụ. Bắt đầu transaction, dedupe messageId/consumer và business key, cập nhật state + response outbox, commit rồi ack.
- [ ] Duplicate đúng payload trả/phát lại kết quả đã lưu. Cùng business request ID khác hash là conflict có dấu vết, không thực hiện lần hai.
- [ ] Retry tạm thời dùng retry_jobs bền vững: 5/15/60 giây cộng jitter, tối đa 3 retry theo SRS. Ack delivery gốc sau khi job commit; RETRY_SCHEDULED chưa phải PROCESSED.
- [ ] Schema/producer sai hoặc hết retry đi quarantine/dead-letter có record, metric và publish confirm; không requeue nóng và không purge queue để sửa demo.
- [ ] Test crash trước publish, sau confirm trước mark, sau consumer commit trước ack. Khởi động lại không tạo visit/order/receipt hoặc tác dụng phụ đôi.
- [ ] Chặn ghi lùi terminal state bởi bản tin cũ; projection snapshot có version/checkpoint. Replay giữ messageId; command đã xử lý dùng command result cũ.
- [ ] Shutdown worker có giới hạn, finish/nack an toàn; metric oldest outbox, duplicate, retry, DLQ, projection lag; cùng correlationId nối HTTP và AMQP.

**Đạt khi:** bài test với RabbitMQ + PostgreSQL thật chứng minh duplicate/restart/retry. Unit test broker giả vẫn hữu ích nhưng chưa đủ nghiệm thu tích hợp.

## 9. H06 Hoàn tất Catalog và ghép W03

**Sửa:** Catalog worker/migration/auth/cache adapters, `apps/web/src/features/catalog`, `contracts/http/catalog-integration.md`; Hưng ghép Gateway/shared transport, Quân ghép route/callback.

- [ ] Chốt CatalogChanged entityType/fullSnapshot/revision/streamSequence/mode với consumer; publisher gửi outbox đang PENDING.
- [ ] Chứng minh Appointment/Billing/Clinical/Diagnostic/Pharmacy nhận projection đúng theo contract; consumer owner tự triển khai phía họ.
- [ ] Đổi giá chỉ tạo version tương lai; charge/order/toa có snapshot cũ không bị sửa theo giá mới. Kiểm giá chưa hiệu lực, hết hiệu lực, null và khoảng giáp ranh.
- [ ] Catalog nhận thay đổi quyền từ Identity; bỏ phụ thuộc seed quyền tĩnh khi demo auth live.
- [ ] Cache đọc có TTL/generation/invalidation/jitter theo SRS; cache là dữ liệu dựng lại được. Lỗi Redis timeout 100 ms; sau 5 lỗi liên tiếp mở mạch 15 giây; DB fallback có giới hạn, quá tải trả 503 rõ.
- [ ] W03 dùng shared transport trả Response nguyên envelope, giữ Idempotency-Key khi retry, chuyển doctorId/serviceId cho màn slot của Quân; không biến price:null thành 0.
- [ ] Seed Catalog có cửa sổ giá hữu hạn: kiểm thời điểm demo, tạo version hợp lệ thay vì sửa giá lịch sử. Ghép login thật và lease thật cho CA-004.

**Đạt khi:** six API regression đạt, giá được consumer nhận, W03 qua Gateway, mất cache không làm sai giá snapshot/quyền. Bằng chứng tích hợp bổ sung cho kết quả local cũ.

## 10. H07 Nhận lượt khám và lưu nháp CL-001 đến CL-004

**FR/UC:** FR-15, UC-05/06. **Dự kiến tạo:** Clinical `internal/domain/visit.go`, `start_request.go`, `internal/application/usecase/start_visit.go`, `visit_queries.go`, `save_draft.go`, `internal/application/ports/clinical.go`, repository/HTTP/message adapters và test tương ứng.

**Đầu vào:** contract vé của Quân đã chốt ở H00; quyền/projection, DB và worker sẵn sàng.

- [ ] CL-001 lọc đúng bác sĩ, ngày/trạng thái/phân trang; operationId chỉ trả request thuộc bác sĩ đăng nhập, kể cả chưa có visit.
- [ ] CL-002 nhận ticketId/doctorId/expectedTicketVersion + key; kiểm doctorId khớp actor; lấy patientId từ nguồn đáng tin đã thống nhất. Transaction ghi start_requests PENDING + ClaimQueueTicket, trả 202 có operationId/statusUrl.
- [ ] Consumer QueueTicketClaimed ACCEPTED tạo đúng một visit cho appointment, lưu claimId/patient/doctor/phạm vi. REJECTED ghi lý do và không tạo visit.
- [ ] FIRST tạo mới; RETURN tiếp tục đúng visit cũ, không sinh visit/phí khám mới. Lưu kết quả xử lý để replay không đổi kết quả đã chốt.
- [ ] CL-003 lọc DTO theo actor; bệnh nhân không thấy notes nháp hoặc toa DRAFT. Không trả nguyên database model cho mọi actor.
- [ ] CL-004 PUT cả symptoms/findings/assessment/diagnosis và expectedVersion; ghi notes revision/người sửa; lệch version trả 409, visit đã ký không sửa.
- [ ] W10 hiển thị PENDING khi nhận lượt, poll CL-001 theo operationId; có lỗi bị từ chối và conflict khi lưu nháp. Không điều hướng vào visit chưa tồn tại.

**Test bắt buộc:** `start_returns_202_before_claim`, `duplicate_claim_creates_one_visit`, `rejected_claim_creates_no_visit`, `return_reuses_visit`, `draft_stale_version_conflicts`, `other_doctor_cannot_poll_start`. Assert DB count/ID/version/outbox, không chỉ HTTP status.

**Đạt khi:** từ vé Quân bàn giao → start pending → claim → visit → lưu nháp chạy được qua Gateway/broker; gọi lặp vẫn một visit.

## 11. H08 Toa thuốc và ký khám không LAB

**API:** CL-006/007/008/009/010; FR-18/19, UC-06. **Dự kiến tạo:** Clinical `domain/prescription.go`, `application/usecase/prescriptions.go`, `complete_visit.go`, PostgreSQL/HTTP adapters và test.

- [ ] CL-006 tạo DRAFT trong visit hợp lệ. Resolve medicineCode từ Catalog projection, xác minh thuốc hợp lệ, lưu snapshot tên/mã/liều/số lượng/hướng dẫn; không tin snapshot tên client gửi.
- [ ] CL-007 thay toàn bộ lines theo expectedVersion; quantity nguyên dương. CL-008 xóa mềm DRAFT theo expectedVersion ở query, giữ audit; trả 200 với ID/state theo contract.
- [ ] CL-010 khóa visit, kiểm dữ liệu bắt buộc và tập lab_requests/lab_status_projection cục bộ; chỉ ký khi không còn ý định LAB unresolved và tất cả order liên quan PUBLISHED/CANCELLED hợp lệ. Quy tắc trường bắt buộc lấy từ schema đã chốt, không tự buộc mọi trường nháp phải có nội dung.
- [ ] Transaction ký ghi signedAt/signedBy/version và VisitSigned. Event đến Appointment chuyển COMPLETED; khi chưa đồng bộ UI giữ trạng thái thật.
- [ ] CL-009 chỉ FINAL sau visit SIGNED, toa có ít nhất một dòng, tối đa một FINAL hiệu lực. Ghi snapshot/revision và PrescriptionFinalized cùng transaction; Quân nhận đúng revision.
- [ ] Retry cùng key trả kết quả cũ; khác key vẫn không tạo hai hiệu ứng terminal. Bản SIGNED/FINAL không sửa hoặc xóa bằng endpoint nháp.
- [ ] W10 có thao tác lưu toa, sửa/xóa nháp, ký visit rồi ký toa, tải lại bản mới khi conflict. Không gộp hai API ký thành một thành công giả khi API thứ hai lỗi.

**Test bắt buộc:** `finalize_before_signed_rejected`, `finalized_prescription_immutable`, `empty_final_rejected`, `complete_with_pending_lab_rejected`, `complete_vs_create_lab_serialized`, `sign_retry_emits_once`. Test cạnh tranh chạy với transaction DB thật; test LAB có thể dựng fixture registry trước H09.

**Đạt khi:** khám không LAB → ký visit → FINAL → Pharmacy nhận projection; bệnh nhân chỉ đọc bản hợp lệ. Nếu Pharmacy chưa chạy, ghi riêng local PASS và integration BLOCKED.

## 12. H09 Chỉ định LAB và tạo order bất đồng bộ

**API:** CL-005, DI-002/003, DI-001 phục hồi. **FR:** FR-16/28. **Dự kiến tạo:** Clinical `domain/lab_request.go`, `application/usecase/request_lab.go`; Diagnostic `domain/lab_order.go`, `application/usecase/create_order.go`, `order_queries.go`, các adapters/test.

- [ ] CL-005 kiểm visit/quyền, tests không rỗng, testId/revision hợp lệ trong projection; chụp định nghĩa/mã/đơn vị/khoảng tham chiếu theo contract.
- [ ] Khóa cùng visit với CL-010; ghi lab_requests PENDING + CreateLabOrder nguyên tử. Response 202/requestId/statusUrl trỏ CL-003; timeout giữ pending.
- [ ] Diagnostic chỉ nhận producer Clinical hợp lệ; dedupe requestId/hash; tạo order UNIQUE clinical_request_id, snapshot giá và RequestCharge + LabOrderResolved cùng transaction inbox.
- [ ] Nếu từ chối có căn cứ, phát LabOrderResolved REJECTED/reasonCode; không để request mất dấu. Clinical mapping FAILED trong DB/REJECTED ra ngoài theo quyết định H00.
- [ ] CREATED gắn orderId và chuyển WAITING_LAB; event đến lặp hoặc đến sau trạng thái tiến hơn không làm lùi trạng thái. Nhiều LAB phải theo dõi đủ tập request.
- [ ] DI-002/003 cho LAB_TECH/LAB_REVIEW/DOCTOR theo API; danh sách lọc/phân trang, chi tiết order/phí/mẫu/kết quả đúng quyền.
- [ ] DI-001 dùng cùng handler idempotent và contract phục hồi H00; cấu hình mặc định tắt, test Gateway không mở và user token không gọi được. Chỉ profile phục hồi có service identity/audit mới chạy.
- [ ] W10 chọn test từ CA-006, hiển thị registry pending/rejected/order có thật; resubmit/hủy ý định theo contract đã chốt, không coi lỗi mạng là order bị hủy.

**Test bắt buộc:** `lab_request_and_outbox_atomic`, `duplicate_create_lab_one_order_one_charge_request`, `same_request_different_hash_conflicts`, `diagnostic_down_request_stays_pending`, `rejected_request_blocks_sign_until_resolved`, `recovery_adapter_disabled`.

**Đạt khi:** dừng Diagnostic vẫn nhận CL-005 theo quy tắc an toàn; bật lại tạo một order và một RequestCharge. Luồng chính không gọi DI-001 hoặc HTTP Billing.

## 13. H10 Thanh toán LAB lấy mẫu lấy lại và hủy

**API:** DI-004/005/006/012; FR-20/21/23, UC-07/08. **Phụ thuộc:** Hưng bàn giao ChargePrepared/ChargePaid/ReserveSettlement/SettlementDecision và QuerySettlement. **Dự kiến tạo:** Diagnostic `domain/settlement.go`, `specimen.go`, `application/usecase/settlement.go`, `specimens.go`, `cancel_order.go`, adapters và test.

- [ ] ChargePrepared gắn chargeId/state đúng request/sourceRevision; REJECTED có lý do. Không cho lấy mẫu chỉ vì đã có chargeId.
- [ ] ReserveSettlement khóa đúng LAB_ORDER/sourceId/sourceRevision/amountHash trong DB, cấp fence tăng đơn điệu và phát SettlementReserved. Order đã hủy hoặc không hợp lệ phải REJECTED.
- [ ] Áp dụng ChargePaid/SettlementDecision đúng producer, settlementId, sourceRevision, fence; duplicate/đảo thứ tự có một hiệu ứng. Quyết định FAILED đến trước ReserveSettlement phải lưu tombstone, reserve muộn không khóa lại.
- [ ] UNKNOWN hoặc timeout không tự mở SETTLEMENT_LOCKED. Owner phát QuerySettlement mỗi 30 giây theo SRS khi còn khóa; Billing quyết định bằng DB bền vững. Huy không viết lại saga tiền của Hưng.
- [ ] DI-004 chỉ tạo COLLECTED khi có bằng chứng PAID/fence cục bộ; thiếu đồng bộ hiển thị PENDING_SYNC và từ chối thao tác theo HTTP/error contract đã chốt. Không gọi HTTP Billing để kiểm tiền.
- [ ] Barcode unique; chỉ một mẫu hợp lệ ở bước tương ứng. Ghi collectedBy từ actor thật; không nhận quyền người lấy mẫu từ body.
- [ ] DI-005 yêu cầu reasonCode/version, chỉ reject mẫu còn đủ điều kiện, giữ lịch sử. DI-006 tạo sequence mới trong cùng order, không tạo phí LAB thứ hai.
- [ ] DI-012 khóa cùng order với lấy mẫu/settlement. Chỉ hủy trước bất kỳ specimen nào, kể cả mẫu cũ đã REJECTED; không hủy khi đang khóa tiền chưa có quyết định cho phép. Tạo cancellationId bền vững, LabCancelled(noSpecimen=true) cùng transaction.
- [ ] Chưa thu thì Billing void; đã thu chưa sử dụng thì Billing xử lý refund. Diagnostic giữ refundStatus projection theo H00; refund FAILED không làm order hết CANCELLED, retry không tạo căn cứ hoàn mới.
- [ ] W12 có hàng chờ, chi tiết phí, lấy mẫu, reject có lý do, recollect và lỗi quyền/conflict. Thao tác hủy của DOCTOR nằm ở luồng bác sĩ; không cấp LAB_TECH quyền hủy chỉ vì dùng chung màn LAB.

**Test bắt buộc:** `sample_without_local_paid_denied`, `stale_fence_ignored`, `failed_before_reserve_never_relocks`, `unknown_keeps_lock`, `cancel_vs_sample_one_valid_winner`, `recollect_same_charge_new_sequence`, `cancel_after_rejected_specimen_denied`, `duplicate_cancel_same_cancellation_id`. Kiểm cuối DB của owner, không chỉ toast thành công.

**Đạt khi:** thu phí thật qua Billing → đồng bộ bằng chứng → lấy mẫu; mẫu lỗi lấy lại cùng phí; hủy trước mẫu tạo căn cứ hoàn đúng một lần. Các đường chưa có Billing chỉ là unit/integration cục bộ, chưa E2E.

## 14. H11 Nhập gửi duyệt trả sửa và công bố kết quả

**API:** DI-007–011; FR-22, UC-07. **Dự kiến tạo:** Diagnostic `domain/result.go`, `application/usecase/results.go`, `review_result.go`, `publish_result.go`, repository/HTTP adapters/test; web trong feature Diagnostic.

- [ ] DI-007 chọn specimen hợp lệ thuộc cùng order; tạo DRAFT và result_items theo test snapshot. Client không tự chọn mẫu của order khác hoặc chỉ số ngoài danh sách đã chỉ định.
- [ ] DI-008 chỉ sửa DRAFT/REWORK với expectedVersion; lưu người đóng góp trong contributor_user_ids. Danh sách này phải giữ mọi người đã nhập/sửa revision, không chỉ người cuối cùng.
- [ ] DI-009 kiểm đủ chỉ số/dữ liệu bắt buộc rồi chuyển REVIEW, ghi submittedAt. Chưa đủ trả RESULT_INCOMPLETE; REVIEW chưa phải công bố.
- [ ] DI-010 reviewer đủ quyền trả REVIEW về REWORK với reason, ghi review/audit; kỹ thuật viên sửa rồi submit lại. Kiểm quy tắc hai người cho hành động review theo contract đã chốt.
- [ ] DI-011 kiểm LAB_REVIEW, state/version và reviewer không thuộc contributor_user_ids; nếu tự duyệt trả 409 SELF_REVIEW_FORBIDDEN dù actor đồng thời có LAB_TECH và LAB_REVIEW.
- [ ] Transaction publish ghi PUBLISHED/publishedAt/reviewer/revision và LabResultPublished. Bản PUBLISHED bất biến; không cho update/delete qua lối nháp.
- [ ] Event gửi Clinical/Notification đúng contract; không đưa valueText/nội dung bệnh án vào message thông báo. Snapshot order/result trong DB vẫn đủ cho đọc bản công bố.
- [ ] W12 tách chế độ kỹ thuật viên và người duyệt, có draft/review/rework/published; lỗi version yêu cầu tải lại, không ghi đè bản người khác sửa.

**Test bắt buộc:** `result_requires_valid_specimen_same_order`, `submit_incomplete_rejected`, `past_contributor_cannot_publish`, `dual_capability_does_not_bypass_self_review`, `publish_vs_edit_serialized`, `published_result_immutable`, `duplicate_publish_one_event`.

**Đạt khi:** tài khoản KTV A nhập → reviewer B trả sửa → A sửa/gửi lại → B publish; A tự publish bị chặn ở backend. Bằng chứng gồm request, audit, state/version và event.

## 15. H12 RETURN và hồ sơ đã công bố

**API:** hoàn thiện CL-002/003/010, CL-011 và DI-013; FR-17/18, UC-07/10. **Dự kiến tạo:** Clinical `application/usecase/lab_status.go`, `medical_records.go`; Diagnostic `application/usecase/published_results.go`; W08 trong các feature hiện có.

- [ ] Clinical nhận LabResultPublished/LabCancelled, cập nhật lab_status_projection đúng version; chỉ khi toàn bộ request đã giải quyết và order đều terminal hợp lệ mới RETURN_READY.
- [ ] Ghi VisitReturnReady cùng transaction, returnRound theo baseline một vòng. Quân tạo một vé RETURN; nhận QueueTicketClaimed của RETURN tiếp tục visit cũ, không thu phí khám mới.
- [ ] Không ghi lùi SIGNED khi event LAB cũ đến muộn. RETURN vắng không biến lượt đã khám thành FIRST NO_SHOW; phối hợp trạng thái với Appointment.
- [ ] CL-011 chỉ danh sách bản SIGNED; CL-003 với PATIENT chỉ trả bản ký và toa FINAL. Không lộ notes revision cũ, toa DELETED hoặc registry nội bộ không được phép qua serialization.
- [ ] DI-013 chỉ PUBLISHED thuộc patientId được phép, có phân trang; DRAFT/REVIEW/REWORK không xuất hiện. DI-003 không mở cho PATIENT để né bộ lọc.
- [ ] W08 `/patient/records/*` dùng CL-011/DI-013 và chi tiết được phép; web gọi mỗi owner qua Gateway, không buộc Clinical gọi Diagnostic đồng bộ. Có trạng thái chưa có hồ sơ/kết quả.
- [ ] Bàn giao response mẫu và seed cho Android Hưng; app chỉ đọc bản công bố qua cùng API, không thêm API/backend Android riêng.

**Test bắt buộc:** `all_labs_required_for_return`, `pending_lab_blocks_complete`, `duplicate_publish_one_return`, `return_claim_same_visit`, `old_event_cannot_reopen_signed_visit`, `patient_detail_never_exposes_drafts`, `cross_patient_records_denied`, `published_results_exclude_review`.

**Đạt khi:** khám có LAB → công bố → RETURN → ký → FINAL → bệnh nhân thấy cùng bản trên web/Android. Bản không LAB vẫn chạy sau thay đổi.

## 16. H13 Hoàn thiện bốn nhóm màn web

Làm UI cùng task backend, không chờ tất cả API xong mới bắt đầu. Task này là vòng rà soát đủ màn và hành vi chung.

**Sửa/tạo trong phạm vi Huy:** `apps/web/src/features/catalog/`, `clinical/`, `diagnostic/`. Đề xuất đặt page, hook, API adapter, DTO và test cạnh feature; export component/route descriptor theo giao diện Quân đã chọn. Quân sửa `src/app`/shared UI; Hưng sửa shared API/session. Các route dưới lấy từ tài liệu kiến trúc; W03 ghép theo route registry hiện hành do Quân chốt.

| Nhóm màn | Bắt buộc có | API chính |
| --- | --- | --- |
| W03 | Khoa, bác sĩ/lọc, dịch vụ/giá, danh mục thuốc/test đúng quyền, tạo giá ADMIN, chọn để sang slot | CA-001–006 |
| W10 `/doctor/worklist`, `/doctor/visits/*` | Nhận lượt và poll; nháp khám; chỉ định và trạng thái LAB; toa DRAFT; ký visit; FINAL; RETURN | CL-001–010, CA-005/006, DI-012/chi tiết theo quyền |
| W12 `/staff/lab/*` | Queue/filter; order/phí/mẫu; reject/recollect; nhập/sửa; gửi duyệt/trả sửa/publish | DI-002–011; không mở DI-001 |
| W08 `/patient/records/*` | Bản khám SIGNED, toa FINAL, LAB PUBLISHED, chọn hồ sơ đúng quyền | CL-003/011, DI-013 |

- [ ] Mỗi màn có loading, empty, validation, 401, 403, 409, 503/lỗi mạng; thao tác async có pending và lý do chưa hoàn tất.
- [ ] Poll đúng statusUrl/requestId, dừng khi terminal/unmount/logout, có khoảng chờ và giới hạn hợp lý được nhóm chốt; timeout chỉ thông báo còn chờ, không tự đặt FAILED.
- [ ] Giữ key/body khi thử lại ý định cũ; thay body là ý định mới. Giữ key cả khi token/lease được làm mới; không double submit.
- [ ] Không để response muộn của bệnh nhân/visit A ghi đè màn B. Đổi tài khoản phải xóa state nhạy cảm của phiên cũ.
- [ ] Nút ẩn/disabled theo quyền và trạng thái nhưng backend vẫn là nơi quyết định. 409 cho đọc bản mới, không tự ghi lại với version mới mà người dùng chưa xem.
- [ ] Kiểm 360/768/1440px, bàn phím/tab/focus, nhãn field, error gắn đúng trường; bảng rộng không làm mất nút thao tác.
- [ ] Test component hành vi bất đồng bộ/phiên/quyền; test browser qua Gateway và tài khoản thật. Chuyển test Catalog khỏi preview vào runner chung khi shell đã có, giữ test hồi quy.

**Đạt khi:** từng hàng có demo thành công + lỗi + quyền, dùng dữ liệu thật; ghi rõ commit shell/shared transport tích hợp. Chỉ chạy Vitest preview chưa đủ.

## 17. H14 Bàn giao cho Quân và Hưng

**Dự kiến tạo:** `docs/implementation/huy-handoff.md` và fixture trong `contracts/messages/examples/`. Bàn giao từng luồng ngay khi xong, không đợi cuối.

| Huy giao/nhận | Bên phối hợp | Gói cần có | Kiểm bàn giao |
| --- | --- | --- | --- |
| Giá, danh mục, CatalogChanged | Quân và Hưng | Snapshot/version, null, thời gian hiệu lực, mapping ID | Đổi giá không đổi khoản thu cũ; consumer nhận event |
| ClaimQueueTicket/QueueTicketClaimed | Quân | Nguồn vé, FIRST/RETURN, doctor/patient mapping, version, reject | Lặp claim một visit; RETURN dùng lại visit |
| VisitSigned/VisitReturnReady | Quân | appointmentId/version/returnRound | Một RETURN và một lần COMPLETED, không lùi state |
| PrescriptionFinalized | Quân | patientId/revision/itemsSnapshot và key chống trùng | Toa xuất hiện ở Pharmacy, giữ/phát đúng một lần |
| RequestCharge và settlement LAB | Hưng | sourceType LAB_ORDER, revision/hash/fence, các trạng thái và retry | Chỉ có bằng chứng đúng mới lấy mẫu; UNKNOWN vẫn khóa |
| LabCancelled/refund projection | Hưng | cancellationId/noSpecimen/reason/version; mapping phí/hoàn | Hủy trước mẫu; hoàn FAILED/retry không nhân đôi |
| Auth/lease/access projection | Hưng, Patient của Quân | Claim/keys/policy, owner mapping, bootstrap/checkpoint | JWT cũ không vượt quyền; thiếu projection không cho ghi |
| W03/W08/W10/W12 | Quân và Hưng | Export feature, route/DTO, transport, quyền, UI state | Chạy từ login qua Gateway, không dùng token panel preview |
| Hồ sơ công bố cho Android | Hưng | CL-011/DI-013 và chi tiết được phép, seed giả, error mẫu | Web/Android cùng account cùng bản SIGNED/PUBLISHED |

**Mỗi gói bắt buộc có:** commit/schema version; request-response hoặc message thật đã lược dữ liệu nhạy cảm; seed ID; test một đúng/một lỗi; cách chạy; giới hạn chưa xử lý; người nhận và kết quả họ chạy lại.

**Đạt khi:** người nhận tự chạy được, consumer compatibility test và demo tích hợp có bằng chứng. Gửi tên endpoint hoặc ảnh UI chưa phải hoàn thành bàn giao.

## 18. H15 CI và ma trận kiểm thử chấp nhận

**Sửa:** `.github/workflows/huy-go.yml`, `tools/huy/` validators. **Dự kiến tạo:** `tests/e2e/huy-clinical-lab/`, `tests/contract/`, `docs/implementation/huy-traceability.md`. Chọn runner theo stack test chung đã chốt với nhóm, ghi lệnh thực tế vào README của tests.

- [ ] CI theo path phải bắt `contracts/http/clinical*`, `diagnostic*`, `contracts/messages/**`, feature Clinical/Diagnostic và E2E mới. Workflow hiện tại chủ yếu bao phủ Catalog ngoài ba Go module.
- [ ] Mỗi service fmt/vet/unit/race/build độc lập; PostgreSQL integration riêng cho Clinical/Diagnostic, broker test có RabbitMQ thật. Không skip test vì thiếu DB rồi coi là pass.
- [ ] Kiểm OpenAPI schema, response thật, event/command fixture, số operationId, producer/consumer compatibility và dependency direction.
- [ ] Build web chung và Docker image từng service Huy; smoke migration/readiness. API và worker có cấu hình chạy riêng, graceful shutdown, secret ngoài source, image non-root theo SRS.
- [ ] Điều phối check của sáu service còn lại cùng owner; Android build do Hưng cung cấp. Một workflow Huy xanh không chứng minh toàn repo xanh.
- [ ] Ma trận FR–UC–API/message–test–evidence–commit–status; mỗi FR Huy phụ trách có ít nhất một test khẳng định hành vi, không chỉ một ảnh màn hình.

### Bộ test tối thiểu trước khi chốt phần Huy

| Mã | Thiết lập và hành động | Kết quả bắt buộc | Task / truy vết |
| --- | --- | --- | --- |
| HT-01 | Tạo giá mới, đọc charge/order có snapshot cũ | Lịch sử không đổi; giá không hiệu lực trả null đúng | H06; FR-06/07, BAC-13 |
| HT-02 | Hai request start cùng vé, rồi replay message | Một claim hợp lệ và một visit; key khác payload conflict | H07; FR-15, BAC-05/21 |
| HT-03 | Hai bác sĩ/version cùng lưu nháp | Ghi sai owner bị chặn; stale version không ghi đè | H04/H07; FR-15/33 |
| HT-04 | Tạo LAB và complete visit đồng thời | Serialize tại Clinical; không có visit SIGNED với LAB mới unresolved | H08/H09; BAC-18 |
| HT-05 | Tắt Diagnostic khi CL-005 rồi bật lại | Pending bền vững; một order, một RequestCharge | H09; BAC-20/23 |
| HT-06 | Publish cùng business message hai lần, redelivered=false | Một hiệu ứng; inbox/business key vẫn bảo vệ | H05/H09; BAC-21 |
| HT-07 | PAID cũ/sai fence hoặc chưa có bằng chứng | Không lấy mẫu; đúng bằng chứng mới chuyển tiếp | H10; FR-20 |
| HT-08 | FAILED đến trước reserve; hoặc Query trả UNKNOWN | Tombstone ngăn khóa lại; UNKNOWN không nhả khóa | H10; BAC-24 |
| HT-09 | Cancel và lấy mẫu chạy song song | Chỉ kết quả hợp lệ theo lock thắng; không vừa hoàn vừa sử dụng | H10; BAC-18 |
| HT-10 | Reject mẫu, recollect; thử hủy order sau đó | Sequence mới, giữ mẫu cũ và phí cũ; hủy bị chặn | H10; FR-21/23 |
| HT-11 | A nhập, B sửa, A hoặc B có quyền review và thử publish | Cả contributor đều không tự duyệt revision; C hợp lệ mới duyệt | H11; FR-22 |
| HT-12 | Publish lặp, event đảo thứ tự, nhiều LAB | Một RETURN khi đủ điều kiện; không mở lại visit đã ký | H12; FR-17, BAC-15 |
| HT-13 | Patient gọi list/detail của nháp và hồ sơ người khác | Không lộ DRAFT/REVIEW/REWORK hoặc dữ liệu chéo patient | H04/H12; BAC-02/10 |
| HT-14 | Toa trước ký visit, sửa FINAL, phát event FINAL lặp | Chặn trạng thái sai; Pharmacy không nhân đôi bản toa | H08/H14; FR-19/24 |
| HT-15 | Crash tại ba điểm outbox/inbox rồi restart | Không mất nghiệp vụ đã commit; không tạo hiệu ứng đôi | H05; BAC-23 |
| HT-16 | Schema sai, producer sai, lỗi tạm thời liên tục | Quarantine hoặc retry tối đa; không nóng CPU/requeue, không ack trước commit | H05; BAC-27 |
| HT-17 | Thu hồi quyền, giữ JWT cũ, trì hoãn event, hết lease | Lệnh nhạy cảm bị chặn trong cửa sổ lease tối đa 30 giây | H04; BAC-17/25/26 |
| HT-18 | Tắt/flush Redis ở môi trường test | Không mất khóa/tiền/mẫu/tồn; fallback giới hạn | H06/H16; BAC-22 |
| HT-19 | DI-001 profile mặc định và user token | Gateway không mở; không tạo order ngoài registry | H09; baseline adapter |
| HT-20 | Hai hành trình có/không LAB với web và Android | Trạng thái owner/client nhất quán cuối cùng; pending trung thực | H14/H15; BAC-06/07/09 |
| HT-21 | Dừng Notification khi publish kết quả | Clinical/Billing không bị chặn; restart thông báo không trùng | H14; phối hợp Hưng, BAC-16 |
| HT-22 | Dựng từng service riêng và bootstrap/replay projection | Migrate/build độc lập, checksum đúng, không truy cập DB khác | H03/H04; BAC-19/25 |

**Đạt khi:** test có output, fixture, commit và người review; flaky/fail/block ghi thật. Một ảnh Postman 200 không chứng minh race, isolation hoặc khôi phục.

## 19. H16 Đo hiệu năng cache async và phục hồi

**Dự kiến tạo:** `tests/performance/huy/`, `docs/evidence/huy/nfr-results.md`, hướng dẫn backup/restore trong README owner. Đây là bài đo kỹ thuật, không phải số đã đạt.

| Yêu cầu SRS | Bài đo phải chạy | Điều kiện đạt |
| --- | --- | --- |
| NFR-03 | Seed ≥100 lịch; 30 request đọc đồng thời; ghi thường khi dependency khỏe | p95 tra cứu/lịch <2 giây; ghi thường <3 giây |
| NFR-11 | Warm-up rồi 100 GET cùng bộ lọc; lặp với Redis tắt | Hit ≥80% khi cache bật; p95 đọc <2 giây với 30 request đồng thời; không sai snapshot/capacity |
| NFR-12 | 100 message, đo commit outbox→projection applied; restart có backlog | p95 <5 giây; backlog xử lý trong 60 giây khi dependency khỏe |
| NFR-07 | Web 360/768/1440px + keyboard; Android do Hưng chạy | Thao tác được, lỗi gắn field, không mất nút hoặc lộ nháp |
| NFR-08/10 | Dựng Compose sạch, migration/seed; backup/restore vào DB thử riêng | Khởi động được, dữ liệu và invariant còn đúng; ghi thời gian khôi phục thực đo |

- [ ] Ghi CPU/RAM/OS, Docker/runtime version, commit, cấu hình DB/broker/cache, seed size, concurrency, thời gian warm-up/đo, error rate và output gốc. Không chọn riêng lượt nhanh nhất.
- [ ] API 202 đo thời gian trả nhận request riêng; thời gian hoàn tất nghiệp vụ đo riêng bằng applied projection. Không báo 202 nhanh là thanh toán/LAB đã xong.
- [ ] Đo cả dependency khỏe và lỗi: broker mất thì outbox pending bền vững; DB/projection chưa đủ thì 503 an toàn; Redis mất không làm mất invariant.
- [ ] Kiểm health/live không restart service chỉ vì cache/broker mất; health/ready phản ánh DB/schema/seed và độ sẵn sàng thật.
- [ ] Ngưỡng SRS: oldest outbox/pending saga >60 giây báo động; backlog >10000 outbox chưa gửi thì ngừng workflow mới theo policy. Đây là cấu hình phải kiểm, không phải thành tích benchmark.
- [ ] Huy thử restore ba PostgreSQL DB mình sở hữu sang môi trường test riêng; Quân/Hưng cung cấp bằng chứng các DB của họ. So count/checksum và kiểm các ràng buộc nghiệp vụ sau restore.
- [ ] Không xóa volume hoặc restore đè DB đang dùng để “reset demo”. Script reset phải chỉ rõ database demo/target, có guard và hướng dẫn; chỉ thao tác mất dữ liệu khi đã xác nhận đúng phạm vi.

**Đạt khi:** bảng có actual + PASS/FAIL + bằng chứng; thiếu bài đo ghi NOT RUN. Huy tổng hợp số đo toàn nhóm, không tự nhận đã đo phần chưa chạy.

## 20. H17 Báo cáo demo và bản nộp

**Dự kiến tạo:** `docs/implementation/huy-release-checklist.md`, `docs/implementation/huy-demo-script.md`, `docs/evidence/huy/`; cập nhật README/contract/sơ đồ liên quan sau review.

- [ ] Hoàn thiện README mỗi service: vai trò, env không secret, migrate/seed/API/worker/test/build, state machine, message, cách xử lý lỗi phổ biến và giới hạn còn lại.
- [ ] Chốt ma trận đủ CA-001–006, CL-001–011, DI-001–013; đủ W03/W08/W10/W12; FR-06/07/15–23 và quyền/công bố liên quan. Kiểm toàn nhóm 86/18/5 theo baseline cuối được duyệt.
- [ ] Sơ đồ hệ thống, ERD, sequence có/không LAB, thanh toán, retry và quyền đúng code cuối; cập nhật các quyết định H00 vào nguồn chuẩn được nhóm duyệt.
- [ ] Lưu bằng chứng test vào báo cáo: kết quả, môi trường, commit, thời điểm, correlationId đã lược dữ liệu nhạy cảm, link PR/CI; không chỉ ghi “đã test”.
- [ ] Viết kịch bản demo theo mục dưới; tạo tài khoản giả riêng doctor, patient A/B, LAB_TECH A, LAB_REVIEW B và actor đa quyền để chứng minh self-review vẫn bị chặn. Không đưa password thật vào tài liệu công khai.
- [ ] Huy giải thích được bounded context, DB ownership, vì sao 202, outbox/inbox, retry, fence, LAB registry, quyền hai người và snapshot giá; tự tái hiện một lỗi mà không cần AI chạy hộ.
- [ ] Cùng nhóm dựng từ checkout/bộ môi trường sạch, seed, chạy E2E, build web và APK; thử bằng cùng account patient. Xác minh Docker runtime và CI thực tế, không dùng ghi chú local cũ thay thế.
- [ ] PR `huy → develop` có Quân review, owner consumer review contract và CI xanh. Sau khi nhóm nghiệm thu, release PR `develop → main`, gắn version/tag theo quy định và giữ một bộ source/tài liệu/APK khớp nhau.
- [ ] Kiểm lại quyền repo/branch protection/CODEOWNERS theo tài liệu GitHub 24/10; việc tài liệu tồn tại không chứng minh setting đã bật. Không tự approve PR của mình hoặc merge khi check còn fail.
- [ ] Ghi danh sách lỗi/giới hạn còn lại nếu có; còn lỗi chặn core flow, quyền, tiền, dữ liệu thì chưa đánh hoàn thành.

**Đạt khi:** người khác theo README dựng và demo được phần Huy trong hệ thống tích hợp; báo cáo/contract/source/bằng chứng trỏ cùng bản nộp đã review.

### Kịch bản demo nên chuẩn bị sẵn

1. **Không LAB:** login bệnh nhân → chọn danh mục/đặt/thu → check-in/gọi FIRST → bác sĩ nhận lượt → lưu nháp/toa → ký visit → FINAL → nhà thuốc nhận/giữ/thu/cấp → patient đọc bản cuối. Quân/Hưng vận hành phần owner của họ.
2. **Có LAB:** nhận lượt → CL-005 trả pending → order/charge → thu LAB → KTV lấy mẫu → nhập → reviewer khác publish → RETURN → cùng visit → ký/FINAL → W08/Android thấy kết quả.
3. **Lỗi nghiệp vụ:** tự duyệt bị 409; pending LAB không ký được; mẫu reject rồi recollect không thu thêm; có mẫu thì không hủy; người khác không đọc được hồ sơ.
4. **Lỗi hệ thống:** dừng Diagnostic/broker đúng môi trường test → pending có bằng chứng → bật lại phục hồi một lần; replay message không tạo đôi; Redis tắt không mất state nghiệp vụ.

## 21. Lệnh có thể dùng ngay và lệnh phải bổ sung

Mở PowerShell tại gốc repository. Kiểm lệnh nào đã có và exit code; nếu lệnh fail, dừng nhóm kiểm tra đó và sửa nguyên nhân. Các lệnh dưới không đồng nghĩa chúng đã được chạy lại trong lần soạn hướng dẫn này.

### Kiểm source và Go hiện có

```powershell
git status --short
git branch --show-current
git log -1 --oneline

.\tools\huy\go.ps1 -Service catalog test -count=1 ./...
.\tools\huy\go.ps1 -Service catalog vet ./...
.\tools\huy\go.ps1 -Service catalog build ./...
.\tools\huy\go.ps1 -Service clinical test -count=1 ./...
.\tools\huy\go.ps1 -Service clinical vet ./...
.\tools\huy\go.ps1 -Service clinical build ./...
.\tools\huy\go.ps1 -Service diagnostic test -count=1 ./...
.\tools\huy\go.ps1 -Service diagnostic vet ./...
.\tools\huy\go.ps1 -Service diagnostic build ./...
python tools/huy/check_architecture.py
```

Go helper đặt cache/temp trong `.runtime`. Test skeleton pass chưa chứng minh API chưa viết đã hoạt động. `-race` chạy trong CI Linux theo workflow hiện có; chỉ dùng local khi toolchain hỗ trợ.

### Test PostgreSQL và contract Catalog hiện có

```powershell
python tools/huy/test_postgres.py
python -m pip install -r tools/huy/contract-requirements.txt
python tools/huy/check_catalog_contract.py .runtime/catalog-http-responses.json
```

Lệnh Python yêu cầu môi trường Python có dependencies; dùng venv dự án nếu cần. Script PostgreSQL này hiện kiểm **Catalog**, tạo cluster/DB test riêng theo README; chưa chứng minh Clinical/Diagnostic. H03/H15 phải thêm runner DB thật cho hai service và ghi lệnh đã kiểm vào README. File response phải do lượt test hiện tại sinh ra, không dùng fixture cũ để nói code mới pass.

### Test web preview hiện có

```powershell
Push-Location tools/catalog-preview
npm ci
npm run typecheck
npm test
npm run build
Pop-Location
```

Các script trên tồn tại trong `tools/catalog-preview/package.json`. Khi Quân đã tạo runner shell chung, dùng thêm lệnh test/build web thật được ghi trong README của shell; không đoán `npm test` tồn tại ở `apps/web` hiện tại.

### Compose riêng Huy hiện có

Tạo `infra/compose/.env.local` từ `huy.env.example` **nếu chưa có**, tự điền password demo theo README; không ghi đè file env đang dùng. Docker engine phải chạy.

```powershell
docker compose --env-file infra/compose/.env.local -f infra/compose/huy.catalog.yml config --quiet
docker compose --env-file infra/compose/.env.local -f infra/compose/huy.catalog.yml up --build -d
docker compose --env-file infra/compose/.env.local -f infra/compose/huy.catalog.yml run --rm catalog-migrate -seed
Invoke-RestMethod http://127.0.0.1:8081/health/ready
Invoke-RestMethod http://127.0.0.1:8082/health/ready
Invoke-RestMethod http://127.0.0.1:8083/health/ready
Invoke-RestMethod http://127.0.0.1:8081/api/v1/medical-services
```

Đây là smoke test trực tiếp để phát triển, không thay E2E qua Gateway. Compose hiện tại không tự có các worker/migration nghiệp vụ tương lai; bổ sung cùng owner cấu hình rồi ghi lại lệnh khởi động thực tế. Không dùng `down -v` để chữa migration.

### Cách làm với nhánh và PR

Chỉ làm khi working tree đã được kiểm và giữ an toàn thay đổi đang có. Theo quy định nhóm hiện hành:

```powershell
git fetch origin
git switch huy
git merge origin/develop
```

Nếu conflict, cùng owner đọc từng phần và chạy lại test; không chọn toàn bộ ours/theirs. Sau task, `git diff --check`, đọc diff, stage **đúng file task**, commit nhỏ rồi push `huy` và tạo PR vào `develop` theo quy định nhóm. Không dùng `git add .` khi còn Word/CSV untracked hoặc thay đổi không thuộc task. Không force-push hoặc reset để làm sạch source của người khác.

## 22. Mẫu ghi task và bằng chứng dùng cho mọi lần tiếp tục

```text
Task: Hxx - tên task
Trạng thái: TODO / DOING / BLOCKED / REVIEW / INTEGRATED / DONE
Owner: Huy
Phụ thuộc: task nào, cần Quân/Hưng giao gì, link issue/commit
Nguồn chuẩn: file/version + FR/UC/API/message
Phạm vi file: những file dự kiến sửa/tạo
Đầu ra: backend, UI, contract, migration/seed, test, README
Ca thành công: seed/input → thao tác → expected state/response
Ca lỗi: seed/input → thao tác → expected error/không đổi DB
Ca retry/race: key/version/message/fence → số hiệu ứng cuối phải có
Bằng chứng: command, exit code, output/log đã lược dữ liệu, commit
Review: ai review, finding đã xử lý, CI của đúng commit
Bàn giao: ai nhận, đã tự chạy hay chưa
Còn thiếu: ghi rõ; không ghi Done nếu vẫn còn tiêu chí bắt buộc chưa đạt
```

**Mẫu yêu cầu AI thực hiện task sau này:**

```text
Đọc docs/HUY_HUONG_DAN_HOAN_THANH_TOAN_BO_TASK.md và phụ lục API.
Thực hiện task Hxx trong phần Huy, trước hết kiểm source hiện tại và dependency.
Giữ code đã có, tuân theo baseline và quy định owner/Git ngày 24/10.
Đọc đúng FR/UC/ERD và schema liên quan; không tự đoán chỗ contract còn mâu thuẫn.
Làm đầy đủ backend, migration/seed, message, UI và tests thuộc task được giao.
Chạy kiểm tra cần thiết, ghi kết quả thật và phần chưa thể tích hợp.
Không đánh dấu Done chỉ vì health/build hoặc mock test pass.
Kết thúc bằng file đã đổi, test đã chạy, dependency còn thiếu và task kế tiếp.
```

## 23. Checklist cuối để biết phần Huy đã thật sự xong

- [ ] 30 operation của Huy được đối chiếu; 29 route client đúng quyền, DI-001 chỉ phục hồi và tắt mặc định.
- [ ] Clinical có nhận FIRST/RETURN, nháp, LAB registry, ký, toa FINAL và bản khám công bố đúng invariant.
- [ ] Diagnostic có order/settlement/mẫu/recollect/kết quả/review/publish/hủy; hai người và payment fence được backend bảo vệ.
- [ ] Catalog có giá/version/snapshot, message/projection và cache đúng baseline; không chỉ standalone preview.
- [ ] Bốn nhóm màn chạy bằng Gateway/Identity/shared client thật, có đủ pending/conflict/error và responsive.
- [ ] Quân nhận được queue/visit/toa/catalog contract; Hưng nhận được billing/auth/Android contract; các consumer đã chạy thật.
- [ ] DB riêng, migration/seed, Docker/API/worker và readiness dùng được từ môi trường sạch.
- [ ] Unit, integration DB/broker, contract, race, auth và E2E có bằng chứng trên bản code cuối.
- [ ] NFR/cache/async/backup-restore có số đo, không dùng mục tiêu làm kết quả.
- [ ] Báo cáo/sơ đồ/ma trận/README/demo/PR/CI cùng phiên bản; không còn lỗi chặn luồng core hoặc quyền/dữ liệu/tiền.
- [ ] Reviewer khác đã xem phần Huy; release theo quy trình nhóm, không tự approve.

Chỉ khi toàn bộ tiêu chí liên quan đạt mới ghi “hoàn thành phần Huy”. Nếu API xong nhưng shell/Billing/Appointment chưa ghép, ghi “hoàn thành cục bộ, còn chờ tích hợp” và chỉ rõ dependency.

## 24. Nguồn trong repository

- [Quy định GitHub ngày 24/10](QUY_DINH_GITHUB_NHOM5_HUY_QUAN_HUNG_20261024.md): nhánh, owner, review và release hiện hành.
- [SRS v5](UMC_Care_SRS_9_Service_v5_20261017.md): FR, state machine, API, NFR và BAC.
- [UC v5](UMC_Care_UC_9_Service_v5_20261017.md): luồng chính/ngoại lệ có và không LAB.
- [ERD v5](UMC_Care_ERD_9_Service_v5_20261017.md): bảng, unique, projection, transaction.
- [BRD v5](UMC_Care_BRD_9_Service_v5_20261017.md): phạm vi nghiệp vụ và quy tắc.
- `UMC_Care_API_86_9_Service_v5_2 - 01_HTTP_86.csv`, `02_ThamSo.csv`, `03_PhanHoi.csv`, `04_Events_18.csv`, `05_Commands_5.csv`, `06_QuyUoc.csv` trong `docs/`: API và message baseline; tên file đầy đủ được ghi trong phụ lục.
- `UMC_Care_Phan_Cong_Va_Quy_Uoc_Chung_3_Nguoi_20261019.docx`: phân công Huy và ranh giới bàn giao; quy trình Git cũ trong Word được thay bởi tài liệu 24/10.
- `UMC_Care_Kien_Truc_He_Thong_9_Service_v5_20261019.docx`: nhóm màn, route và các contract gap cần đóng.
- [Kiểm chứng local trước đây](../tools/huy/VERIFICATION.md) và [bàn giao Catalog](../contracts/http/catalog-integration.md): nguồn phân biệt đã code/test cục bộ với phần tích hợp chưa chứng minh.
