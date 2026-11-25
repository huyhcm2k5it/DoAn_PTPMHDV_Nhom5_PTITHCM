# Bàn giao đồng bộ ERD và API của Quân — 25/11/2026

Chuẩn nghiệp vụ là `docs/HQH_Care_ERD_9_Service_v5_20261017.md`; HTTP theo ba OpenAPI trong `contracts/http`. Không sửa ERD hoặc OpenAPI trong lần triển khai này. Branch `quan`, baseline `7223d59`.

## Schema nghiệp vụ

| Service | Collection và số field ERD |
| --- | --- |
| Patient | patients 14; profile_audit 6 |
| Appointment | schedules 10; slots 8; holds 10; appointments 16; queue_tickets 11; patient_time_locks 3 |
| Pharmacy | inventory 6; stock_receipts 5; prescription_projection 7; medication_holds 14; dispenses 8 |

`_id` là định danh vật lý MongoDB, không tính vào field ERD. Không sinh `__v` hoặc `_id` trong subdocument khoảng giờ. `mongo/erd-business-validators.json` ghi whitelist, required/nullable, kiểu BSON và ràng buộc. `tools/quan/check-erd-schema.js` kiểm tra lại field từ Markdown, hash nguồn và Mongoose; CI chạy bước này.

- `patients.birthDate`: BSON Date tại 00:00 UTC; HTTP trả ngày lịch `YYYY-MM-DD`. So sánh no-op và tìm hồ sơ trùng có chuẩn hóa ngày, đọc được dữ liệu chuỗi cũ trong giai đoạn migration.
- `appointments.priceSnapshotVnd`: BSON int64; HTTP trả số nguyên theo contract. `priceVersion` là UUID phiên bản giá, không phải số revision. `expiresAt` là hạn thanh toán, khác hạn giữ chỗ của hold.
- Ca khám chỉ lưu 10 field. `doctorUserId` và `departmentId` lấy từ Catalog DOCTOR đang ACTIVE; thiếu mapping thì từ chối thao tác. Kiểm tra nguồn trong cùng Mongo session.
- `patient_time_locks` chỉ lưu patientId, intervals, version. Mongo transaction quyết định chống trùng giờ và sức chứa. Redis không quyết định settlement hoặc tồn kho.
- `queue_tickets.visitId` được cập nhật từ VisitSigned. Ngày vé RETURN dựa vào sự kiện tạo vé, không lấy ngày hẹn gốc; RETURN no-show không biến lịch khám đã hoàn thành thành NO_SHOW.
- Medication hold giữ `COMMITTED` sau cấp theo ERD; API trả `DISPENSED` dựa vào chứng từ dispense của đúng hold/toa/revision. Không cấp thuốc hai lần.
- `stock_audit` được giữ theo từ điển kỹ thuật của ERD. Nhập và cấp ghi audit cùng transaction với tồn, chứng từ và outbox.

## Nguồn thay thế các field bị loại

Repository đọc dựng DTO phục vụ API; writer chỉ chọn field nghiệp vụ. Không dùng slotHistory hoặc attemptHistory để giấu metadata kỹ thuật.

| Dữ liệu cần đọc | Nguồn bền vững thực tế |
| --- | --- |
| requestId, recipientUserId, amount/hash, sourceRevision ban đầu | RequestCharge thật trong outbox của owner; snapshot gốc của hold |
| Source revision sau hủy, cancellationId | AppointmentChanged hoặc MedicationHoldChanged do owner phát |
| Appointment fence, counter, reserve attempt | command_results của ReserveSettlement đã thực sự xử lý, lưu command_type, request và response |
| Pharmacy fence và reserve response | Receipt ReserveSettlement thành công trong inbox pharmacy-billing, gồm payload thật và result của handler |
| chargeSync, bằng chứng đã thanh toán | Receipt ChargePrepared, ChargePaid hợp lệ trong inbox; hash, payload và kết quả ghi nguyên tử với mutation |
| Refund status/version | BillingStatusChanged hợp lệ, chọn version mới nhất trong đúng scope |
| Visit, ngày và thứ tự hàng chờ, lịch sử trạng thái | queue_tickets.visitId và các QueueTicketChanged/AppointmentChanged thực tế trong outbox |
| Chủ hồ sơ, tài khoản hiện hành | patient_access_projection và user_access_projection do đúng owner phát |
| Thời điểm FINAL toa | Receipt PrescriptionFinalized đã áp dụng; projection nghiệp vụ chỉ giữ 7 field |
| Lịch gửi QuerySettlement | QuerySettlement thật trong outbox; chọn bản ghi đến hạn trước khi limit để không bỏ đói hold thứ 101 |

Không tạo command result, settlement decision hoặc chứng cứ thanh toán giả. Các inbox/outbox/command_results dùng để dựng trạng thái phải được giữ suốt vòng đời nguồn và thời gian đối soát. Hiện chưa có TTL xóa các chứng cứ này; không thêm job dọn nếu chưa có cơ chế archive/rebuild tương đương.

Các collection kỹ thuật chưa có schema field chi tiết trong ERD được ghi nhận theo implementation owner và hợp đồng message; không tuyên bố chúng khớp một danh sách field mà tài liệu chưa định nghĩa. `schedule_write_locks` tiếp tục là guard kỹ thuật tuần tự hóa việc tạo/sửa ca; không xóa guard hoặc tạo lịch giả để thay khóa. Đây là điểm cần nhóm bổ sung mô tả kỹ thuật khi cập nhật thiết kế sau này.

## PT-003 và tương thích giữa các thành viên

Lễ tân gửi `ownerPhone` theo OpenAPI. Patient phân giải duy nhất qua Identity projection, kiểm ACTIVE/PATIENT/phoneVerified và kiểm lại trong transaction; không suy ra chủ sở hữu từ contactPhone của bệnh nhân.

Contract `identity-access.v1.schema.json` bổ sung `phone` tùy chọn. Identity publisher/export_snapshot phát số thật; Patient giữ để tìm owner. Clinical, Diagnostic và Notification đã cập nhật strict decoder để nhận bổ sung này, vẫn nhận event cũ thiếu phone. Catalog dùng decoder tương thích và không cần lưu phone.

Triển khai consumer trước publisher. Với tài khoản cũ, dùng owner Identity phát lại access event có version tăng hoặc snapshot chính chủ để có phone; không sửa trực tiếp projection bằng số đoán. Không phát password, password hash hay OTP trong event. Thay đổi hợp đồng chung này cần thông báo cho Huy/Hưng khi bàn giao.

AP-005/AP-006 được thêm vào lease policy Identity; verifier Node chấp nhận whitelist action của route, bao gồm alias AP-002/AP-003, vẫn ràng buộc subject/tokenVersion/expiry. Reschedule so phiên bản giá, tiền và tiền tệ, không so hash chứa thời điểm báo giá; snapshot đã chấp nhận cho Billing được giữ nguyên.

## Migration và quyền Mongo

Mỗi service có `scripts/migrate-erd.js`; biến `MONGODB_URI` phải chọn đúng database owner. Lệnh mặc định chỉ dry-run. Ví dụ Appointment, chạy từ repo với env đã nạp đúng:

```powershell
node services/appointment/scripts/migrate-erd.js
node services/appointment/scripts/migrate-erd.js --audit
node services/appointment/scripts/migrate-erd.js --apply --writers-stopped --backup-dir C:/backup/appointment-erd-20261125
node services/appointment/scripts/migrate-erd.js --restore C:/backup/appointment-erd-20261125 --apply --writers-stopped
```

Thay `appointment` bằng `patient` hoặc `pharmacy` cho owner tương ứng. Dừng cả API/worker và mọi writer cùng DB trong cửa sổ cutover trước apply/restore. Kiểm và xử lý message cũ theo hợp đồng; không xóa inbox/outbox để làm dữ liệu hợp lệ.

Apply kiểm toàn bộ dữ liệu đề xuất và nguồn metadata trước khi ghi, sao lưu canonical EJSON kèm checksum và cấu hình validator/index, đọc lại kiểm checksum, rồi thay document trong transaction có kiểm tra nguồn chưa đổi. Không đủ evidence hoặc dữ liệu sai kiểu/required thì dừng và yêu cầu review, không tự bịa giá trị. Restore xác minh đúng owner/database/checksum trước khi ghi. Migration không xóa collection kỹ thuật hoặc drop index.

Startup audit dữ liệu và yêu cầu strict validator. Nếu validator đã đúng, không gọi collMod: tài khoản runtime readWrite chạy được. Cài/đổi validator trên collection cũ cần tài khoản migration có quyền collMod; thiếu quyền báo ERD_SCHEMA_MIGRATION_REQUIRED. Sau migration dùng lại credential runtime. Không cấp quyền quản trị DB rộng chỉ để startup vượt lỗi.

Atlas/cloud chung chưa được migrate, xóa hoặc seed trong đợt triển khai này. Cần dry-run/backup/cutover riêng trước khi đưa code mới vào DB cũ. Dữ liệu legacy thiếu chứng cứ có thể cần xử lý thủ công; đó là điều kiện triển khai, không phải trường hợp tự động được coi là đã chuyển đổi.

## Kết quả kiểm chứng

- 175/175 Mongo regression, không skip; gồm strict raw BSON, ownerPhone, AP-005 → AP-008, tranh chấp, settlement/replay, migration/restore/checksum, RETURN khác ngày và QuerySettlement 101 hold.
- Node unit: Patient 1, Appointment 9, Pharmacy 2. Format/check đạt.
- Web: 91 test; format, typecheck và build đạt. Không đổi màn hình trong scope này.
- PostgreSQL: Identity 42, Billing 33, Notification 26 test đạt; không dùng SQLite để kết luận concurrency.
- Clinical và Diagnostic: Go unit/integration với PostgreSQL cô lập đạt; consumer strict có kiểm trường phone mới. Các test broker Go cần biến TEST_AMQP_URL riêng không được dùng để tuyên bố đã chạy nếu runner bỏ qua; broker Node và main Compose có bằng chứng chạy RabbitMQ thật.
- Main Compose dùng chính infra/compose/compose.yaml cộng override/env local cô lập, project umc-erd-plan-20261125. Toàn bộ stack được build/start; dùng Gateway, JWT/lease Identity, Catalog bootstrap, PostgreSQL, Mongo replica set, RabbitMQ và Redis thật. Không dùng DB hoặc broker cloud cho mutation test.
- Luồng thật đạt: lễ tân tạo hồ sơ → tạo/sửa ca → giữ/nhả slot → đặt và thanh toán → đổi lịch → check-in/gọi số → Clinical claim/ký khám/FINAL toa → giữ/nhả/giữ lại thuốc → Billing counter → COMMITTED → dispense; hủy lịch đã thu → refund → đồng bộ; no-show; AP-019; Notification.
- 28/28 operation của Patient/Appointment/Pharmacy có response thành công qua Gateway, xác minh theo OpenAPI bằng Ajv. AP-004 đã sửa thiếu available; remainingCapacity được giữ tương thích Web.
- Billing broadcast kh?c owner ???c ghi inbox ignored thay v? retry/DLQ; SettlementDecision v1 kh?ng c? sourceType ???c ph?n lo?i theo source t?n t?i t?i owner. Broker Node: hai integration Patient/Pharmacy đạt, kiểm restart/redelivery và quarantine. Luồng LAB/RETURN, expiry và các trường hợp lỗi được bao phủ bằng suite; không đồng nhất với việc đã diễn tập mọi nhánh lỗi trên Compose qua Gateway.
- ERD snapshot, baseline, Pharmacy OpenAPI generator, topology và Compose syntax check đạt. ERD và ba HTTP contract không sửa.

Bằng chứng và runner Compose lưu local tại `C:/Users/admin/Documents/ChatGPT/HDV/output/erd-compose-20261125`; log regression tại thư mục `tmp` cùng workspace. Không đưa test.env, khóa, token, backup DB hoặc credential vào Git. Bản ghi hành trình không lưu access token. Chưa commit/push.


### Late ChargePrepared after rehold

A late ChargePrepared for a RELEASED/EXPIRED attempt is acknowledged as IGNORED only when its request matches the original RequestCharge in owner outbox and the attempt exists in attemptHistory. It does not overwrite the new charge/attempt. ChargePaid with an incorrect revision is still rejected. The fresh Compose journey exposed this race; the business regression and replay of the original message both passed.

Final verification: 175 Mongo tests passed; both independent Gateway journeys passed; 28 operation responses from the fresh journey match OpenAPI; all 13 raw collections contain zero invalid documents. Appointment and Pharmacy DLQs returned to zero after confirmed replay. The old 14 Clinical and 14 Diagnostic quarantine messages from pre-fix phone decoding remain retained in the isolated test broker, with no new increment in the fresh journey.
