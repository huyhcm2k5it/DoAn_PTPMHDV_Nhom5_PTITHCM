# Bàn giao Quân — tuần 4 Pharmacy — 07/11/2026

## Revision và trạng thái

Nhánh `quan`, baseline `9dd2431`. Đã commit local:
`b2ae85d` Catalog/background jobs; `7e8dc23` backend/tests/contracts;
`264d4bb` web; `7a4fb70` infra/CI/công cụ nghiệm thu. Chưa push, chưa mở PR hoặc merge develop.

Owner giao: Quân. Người nhận: Huy (Clinical/Catalog), Hưng (Billing/Identity/Notification/Android).
Trạng thái: REVIEW local cho phần nghiệp vụ; BLOCKED cho tích hợp live.
Bảng 24 task: [quan-week4-5-status.csv](quan-week4-5-status.csv).
Không có receiver signoff; chưa chuyển INTEGRATED/DONE.

## Phần đã triển khai

- PH-001..008 bằng Express/Mongoose/CommonJS theo cấu trúc src/routes/controllers/services/dbs/workers.
  Kho và nhập kho có audit; receipt/idempotency theo principal/route/key/body.
  Hàng đợi FINAL, staff detail và patient status có DTO riêng.
- Giữ toàn toa trong một transaction, rollback nếu thiếu bất kỳ dòng nào; RequestCharge ghi cùng transaction.
  HELD hết 15 phút/release trả reserved một lần.
- Một hold ổn định mỗi prescription/revision; rehold tăng attemptNo và lưu attemptHistory.
  SETTLEMENT_LOCKED/UNKNOWN không tự timeout mở khóa.
  COMMITTED cần ChargePaid và SettlementDecision SUCCEEDED đúng settlement/fence/source attempt.
  Tồn vẫn reserved khi COMMITTED; PH-008 giảm onHand và reserved cùng lúc phát, một dispense duy nhất.
- FAILED trước Reserve ghi tombstone; reserve nghiệp vụ không hợp lệ phát REJECTED.
  Reserve trước ChargePrepared lưu DB retry; replay phát lại response với fence cũ.
  FAILED mâu thuẫn sau paid không xóa payment evidence hoặc nhả tồn.
- PrescriptionFinalized snapshot bất biến; Catalog PRICE_VERSION dùng itemId, hiệu lực giá và checkpoint <=30s.
  Stream gap không được checkpoint mới tự xóa.
  Identity/Patient projection và tokenVersion/capability kiểm ở server.
- Lease Identity bắt buộc PH002..PH008 (action không dấu gạch, ví dụ PH008), <=30s,
  đúng sub/tokenVersion và không cộng leeway exp. PH001 chỉ cần JWT + capability.
  Web lấy lease qua session adapter; không có adapter thì fail closed.
- Worker chạy outbox, expiry, QuerySettlement và durable retry_jobs 5/15/60 giây + jitter.
  Chỉ ack sau domain hoặc retry/quarantine commit. Poison message có raw body/messageId và outbox quarantine.
- Web: kho/nhập kho, hàng đợi toa, giữ/nhả/reconcile/phát và patient status.
  Retry giữ key; polling abort khi đổi toa/rời trang; UI chỉ cho phát khi server COMMITTED.
- Snapshot exporter FIRST/RETURN đọc Appointment DB, không invent doctor/visit grants.
  Dockerfiles Node dùng root build context để copy shared mongo helpers.
  Compose ghép Go migrations/API/workers; Gateway dùng JWKS JSON; route patient appointments và diagnostic-orders đã bổ sung.

## Contract và routing

HTTP source: [pharmacy.openapi.json](../../contracts/http/pharmacy.openapi.json), OpenAPI 3.1.1.
Reproduce: `node tools/quan/generate-pharmacy-contract.js --check`.
Schema phản hồi HTTP được Ajv kiểm trực tiếp trên response Express thật trong tests/mongo/pharmacy-api.test.js.

| HTTP                                 | Quyền / key / kết quả                                         |
| ------------------------------------ | ------------------------------------------------------------- |
| GET /api/v1/pharmacy/stock           | STAFF[PHARMACY], JWT, filters code/name/page/limit            |
| POST /stock/receipts                 | PH002 lease + UUID Idempotency-Key → 201                      |
| GET /prescriptions/queue             | PH003 lease + STAFF[PHARMACY]                                 |
| GET /prescriptions/{id}              | PH004 lease; staff full DTO hoặc patient owner status-only    |
| POST /prescriptions/{id}/holds       | PH005 lease + key + prescriptionRevision → 202/statusUrl      |
| DELETE /holds/{id}?expectedVersion=N | PH006 lease + key → 200                                       |
| POST /holds/{id}/commit              | PH007 lease + key + expectedAttemptNo → 202, reconcile cục bộ |
| POST /holds/{id}/dispense            | PH008 lease + key + expectedVersion → 200                     |

Mutation body không nhận principal/capability do client khai.
401 token thiếu/sai; 403 quyền/lease; 404 resource foreign/not found; 409 state/version/key/stock;
503 projection chưa đủ. PH-004 thiếu FINAL chọn 503 fail closed theo SRS thay cho 202 ở một số bảng API.

| Direction             | Exchange                                       | Routing key / queue                                                     |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| Clinical → PH         | umc.events.clinical.v1                         | clinical.prescription-finalized.v1 → evt.pharmacy.v1                    |
| Catalog → PH          | umc.events.catalog.v1                          | catalog.catalog-changed.v1 → evt.pharmacy.v1                            |
| Identity/Patient → PH | umc.events.identity.v1 / umc.events.patient.v1 | identity.identity-access-changed.v1 / patient.patient-access-changed.v1 |
| Billing → PH command  | umc.commands.billing.v1                        | pharmacy.reserve-settlement.v1 → cmd.pharmacy.v1                        |
| Billing → PH events   | umc.events.billing.v1                          | billing.charge-prepared.v1 / charge-paid.v1 / settlement-decision.v1    |
| PH → Billing          | umc.commands.pharmacy.v1                       | billing.request-charge.v1 / billing.query-settlement.v1                 |
| PH → Billing event    | umc.events.pharmacy.v1                         | pharmacy.settlement-reserved.v1                                         |
| PH domain events      | umc.events.pharmacy.v1                         | pharmacy.medication-hold-changed.v1 / pharmacy.medication-dispensed.v1  |
| Quarantine            | umc.deadletters.pharmacy.v1                    | pharmacy.quarantine.v1 → dlq.pharmacy.v1                                |

Queue Pharmacy khai báo quorum. Bindings có trong rabbitmq/definitions.json;
`node tools/quan/check-pharmacy-topology.js` đối chiếu receiver routes.
Đây là contract đề xuất đã implement; Hưng/Huy chưa xác nhận live routing/ACL/receiver.

## Sample và seed

Dữ liệu giả deterministic ở tests/mongo/pharmacy-api.test.js và pharmacy-business.test.js:
staff ...0902, patient ...0701, medicine ...0301, prescription ...0501
(prefix đầy đủ trong test: 00000000-0000-4000-8000-000000000xxx).
Mỗi test dùng replica/DB cô lập; không import fixture paid vào shared DB để làm gate.

Sample PH-005 body: `{"prescriptionRevision":1}`, key UUID mới cho ý định mới.
202 data gồm requestId, holdId, state=HELD và statusUrl.
Cùng key/body trả lại kết quả cũ; đổi body cùng key trả IDEMPOTENCY_KEY_REUSED.
Sample PH-008 body `{"expectedVersion":N}`: chỉ COMMITTED + bằng chứng thanh toán đúng mới DISPENSED.
Source message fixtures bao gồm envelope producer/type/schemaVersion và payload canonical;
SettlementDecision không bắt buộc sourceType/chargeId ngoài baseline SRS.
transactionId thanh toán là text có giới hạn, không ép UUID.

Seed shared chỉ insert tồn kho một lần, không giả FINAL/PAID.
Lệnh migrate/seed/setup và nguồn projection xem [Compose README](../../infra/compose/README.md).

## Evidence 07/11/2026

`powershell -File tools/quan/verify-local.ps1` exit 0:
Patient 1/1, Appointment 8/8, Pharmacy 2/2; Mongo 94/94; web 13/13.
Node syntax checks, web TypeScript/build, OpenAPI reproduction, topology và Compose structural validation qua.
Build có warning use-client của react-router, không làm build fail.
PowerShell helpers parse qua. git diff --check qua trước commit.

Log đầy đủ lưu local:
`C:\Users\admin\Documents\ChatGPT\HDV\UMC_Care_Tai_Lieu_Local_20261024\evidence\20261107-week4-5\local-checks.log`.
CorrelationId fixture HTTP: `ph-api-test`; không phải trace Gate 4.
Independent review đã tìm và sửa các lỗi reserve reorder/replay/response, transactionId text và FAILED sau paid.
Chưa có screenshot browser hoặc link CI của commit này.

## Blocker và điều kiện nhận

1. **Hưng — Billing:** consumer hiện đọc payload thô nhưng Quân phát envelope;
   publisher có chỗ phát raw payload; replay ChargePrepared dùng REUSED; fence từng có giá trị text PAID.
   Phải chốt envelope, CREATED/REJECTED, fence số nguyên, QuerySettlement và refund producer.
   Quân không nới guard để chấp nhận thiếu bằng chứng.
2. **Huy — Catalog:** bootstrap/reconciliation đủ stream trước khi mở giá; không sửa checkpoint gap thủ công.
   **Clinical:** import snapshot FIRST/RETURN và cấp/revoke visit grants có nguồn; xác nhận FINAL wire.
3. **Hưng — Identity/shell:** transport/session/lease thật; IA-010 whitelist action theo scope;
   Pharmacy đã kiểm action và capability nhưng issuer policy vẫn cần owner review.
4. **Môi trường:** Docker engine pipe không tồn tại; chưa build image, validate Envoy bằng binary,
   chạy RabbitMQ thật hoặc đo 9 health. Existing classic queues cần owner drain/backup/migrate sang quorum;
   không tự purge/delete hoặc down -v.
5. **Receiver:** chạy [Gate 4](../../tests/e2e/gate4-pharmacy.md), có và không LAB,
   kiểm Web/Android cùng trạng thái và Notification nhận duplicate an toàn.

Kết quả người nhận chạy lại: CHƯA CÓ.
Review/PR/CI: local review đã thực hiện; remote PR/CI CHƯA CÓ.
Quân ký phần local implementation/test; Huy/Hưng bổ sung commit, CI, trace và xác nhận thực tế.
