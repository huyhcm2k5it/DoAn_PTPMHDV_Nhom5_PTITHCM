# Phiếu bàn giao tuần 2 — Quân / Appointment booking

Ngày lập: 31/10/2026

Nhánh làm việc: `quan`

Owner giao: Quân

Owner nhận/review: Hưng (auth, Gateway, Billing), Huy (Catalog projection, CI)
Trạng thái: **REVIEW / BLOCKED ở Gate 2 tích hợp thật**

## Phạm vi

- AP-008 `POST /api/v1/appointment-holds` — giữ chỗ 10 phút, giá snapshot phải được Catalog projection xác nhận.
- AP-009 `DELETE /api/v1/appointment-holds/{holdId}` — release bằng CAS version, trả capacity đúng một lần.
- AP-010 `POST /api/v1/appointments` — consume hold, tạo `PENDING_PAYMENT`, trả `202` và ghi `RequestCharge` vào outbox cùng transaction.
- AP-011 `GET /api/v1/appointments/{appointmentId}` — đọc state/chargeSync/chargeStatus/refundStatus.
- AP-012 `GET /api/v1/patients/{patientId}/appointments` — ownership/capability, filter state/date và phân trang.
- Web: chọn slot → hold → review → tạo lịch → danh sách/chi tiết lịch.

## Contract và vận chuyển

- HTTP/OpenAPI: `contracts/http/appointment.openapi.json` (version 5.2).
- Message envelope: `contracts/messages/appointment-booking.v1.schema.json`.
- RequestCharge: exchange `umc.commands.appointment.v1`, routing key `billing.request-charge.v1`, queue đích `cmd.billing.v1`.
- Billing events: exchange `umc.events.billing.v1`, explicit routing keys tới `evt.appointment.v1`.
- Topology proposal: `rabbitmq/definitions.json`; chưa coi là đã provision trong môi trường chung.

## Schema/seed

- Collections: `holds`, `appointments`, `patient_time_locks`, `idempotency_records`, `outbox`, `inbox`, `settlement_decisions`, access projections.
- Fixture: `tests/mongo/fixtures/booking.json`.
- Seed repeatable: `services/appointment/scripts/seed-demo.js`, `services/patient/scripts/seed-demo.js`.
- Lệnh local:

```powershell
npm.cmd --prefix services/appointment run seed:dry-run
npm.cmd --prefix services/patient run seed:dry-run
npm.cmd --prefix services/appointment run test:integration
```

Các UUID trong fixture là dữ liệu giả, không chứa credential. Seed chỉ upsert allowlist, không reset database.

## Auth, ownership và trạng thái

- Bearer verifier được inject từ Identity/Gateway; thiếu verifier trả `401`.
- Patient chỉ đọc/ghi patient projection sở hữu; STAFF cần capability `RECEPTION`; thiếu/stale projection trả `403`/`503` và không tự suy role từ header.
- Giữ/release/consume/expire dùng Mongo transaction; patient time lock được ghi trước khi kiểm tra overlap.
- `CONFIRMED` chỉ khi ChargePaid khớp sourceType/sourceId/sourceRevision/chargeId/settlementId/fence/amount.
- `PENDING_PAYMENT` quá hạn được đánh `EXPIRED`, giảm `heldCount` một lần và phát `AppointmentChanged`; `SETTLEMENT_LOCKED` không bị job này đụng tới.

## Bằng chứng kiểm thử

Đã có test transaction Mongo cho: slot cuối, idempotency, release/expiry, price projection stale rollback, patient overlap, access projection version/message conflict, AP-010/AP-011/AP-012, pending-payment expiry, Billing source/fence/duplicate và outbox confirm.

Đã có test web typecheck và Vitest cho flow slot hiện hữu + route API mock; chạy lại lệnh và ghi exit code/commit trước khi người nhận xác nhận.

## Giới hạn và blocker

- D01: Hưng chưa bàn giao JWKS/issuer/audience/tokenVersion/lease/Gateway transport thật.
- D02–D04: Catalog price projection và Billing message schemas/samples chưa được review chéo; local default fail closed ở giá và dừng `PENDING_PAYMENT`.
- D06: Compose/ACL/queue user của RabbitMQ chưa ghép đủ chín service.
- D07: CI Node/web riêng chưa được nối vào pipeline của nhóm.
- Vì vậy đây là handoff source + local replica-set evidence, **không tuyên bố Gate 2 hoặc thanh toán end-to-end đã pass**.

## Kết quả người nhận cần chạy lại

1. Review OpenAPI/message schema/topology với Hưng và Huy.
2. Chạy `npm.cmd --prefix services/appointment run check`, `test`, `test:integration`, và seed dry-run.
3. Chạy web `typecheck`, `test -- --run`, `build` trong `apps/web`.
4. Dùng source tích hợp sau khi có D01–D06; cập nhật commit/CI, evidence và trạng thái `INTEGRATED` chỉ sau khi pass thật.

## Commit và kết quả kiểm tra cuối

- `e40d1a7` — `chore(appointment): add repeatable booking demo fixtures`.
- `4e20467` — `feat(appointment): add transactional booking workflow`.
- `a5c0f84` — `feat(appointment): deliver booking messages reliably`.
- `fe05402` — `feat(web): add booking and appointment tracking pages`.
- `ae0c924`, `f5f88fb` — handoff/runbook/worker boundaries.
- `services/appointment`: check 0, unit test 1/1, integration 9/9.
- `services/patient`: check 0, test 1/1.
- `tests/mongo`: check 0, test 42/42.
- `apps/web`: typecheck 0, Vitest 8/8, build 0.

PR: chưa tạo và chưa push/merge; người nhận tạo PR `quan` → `develop` sau khi review D01–D07.
