# Bàn giao Quân — hoàn thiện backlog v3 — 05/11/2026

## Phạm vi

- Nhánh làm việc: `quan`, baseline `fc84795`.
- Thay đổi hiện đang ở working tree local, **chưa commit/push**.
- Kế hoạch nguồn: `C:\Users\admin\Documents\ChatGPT\HDV\UMC_Care_Tai_Lieu_Local_20261024\docs\superpowers\plans\2026-11-05-quan-hoan-thien-backlog-v3.md`.
- Quy định bàn giao: `docs/ban-giao-umc-care/QUY_DINH_CHUNG.md`, `CHECKLIST_BAN_GIAO.md`.
- Bảng máy đọc: `docs/ban-giao-umc-care/quan-backlog-v3-status.csv`.

## Trạng thái 27 task

| Task | Trạng thái local | Bằng chứng / thiếu sót |
| --- | --- | --- |
| QF-00 | DOING/OPEN | Đã tạo decision log và cập nhật route/envelope; D-AUTH/D-BILL/D-RETURN còn chờ owner xác nhận. |
| QF-01 | REVIEW local | Appointment unit mới 4/4; Mongo 42/42; web 8/8; chưa có full race/crash matrix. |
| QF-02 | REVIEW local | RSA verifier runtime cho Patient/Appointment, issuer/audience/expiry/tokenVersion, projection version; chưa có Identity JWKS/lease live. |
| QF-03 | REVIEW local | `IN_SERVICE`, `stateHistory`, index/seed additive, demo date cấu hình; chưa có migration runner cho bản ghi legacy. |
| QF-04 | REVIEW local | Patient search/create/update, ownership/reception scope, `PatientAccessChanged` outbox; cần receiver review và test API mới. |
| QF-05 | REVIEW local | AP-005/006 create/update schedule, overlap/capacity/version guard; web form tạo ca đã có, chưa có integration test concurrent. |
| QF-06 | DOING/BLOCKED | Đã có CatalogChanged projection/checkpoint và price resolver fail-closed; feed pricing/mapping thật vẫn chờ Huy. |
| QF-07 | DOING local | `ReserveSettlement` handler, fence, `SettlementReserved`, payload hash; QuerySettlement/UNKNOWN và Billing wire live còn thiếu. |
| QF-08 | DOING local | cancel event có cancellationId/sourceRevision/refundStatus; chưa có refund projection producer và retry FAILED→SUCCEEDED live. |
| QF-09 | REVIEW local | patient lock + overlap hold/appointment + giữ doctor/service/giá; integration 12/12 xanh. |
| QF-10 | REVIEW local | check-in yêu cầu expectedVersion, PAID/ngày VN, FIRST ticket và envelope `appointmentId/state/ticket`. |
| QF-11 | REVIEW local | call-next CAS + idempotency trong transaction, no-show history, doctor scope, `QUEUE_EMPTY=409`; RETURN policy còn OPEN. |
| QF-12 | DOING local | Appointment AMQP runtime, Patient outbox worker, topology vhost `/umc-care`, confirm/mandatory/retry/quarantine; chưa chạy broker thật. |
| QF-13 | DOING local | ClaimQueueTicket command, CAS ticket/appointment, command_results/inbox/outbox QueueTicketClaimed; chưa chạy Clinical consumer thật. |
| QF-14 | DOING local | VisitSigned và VisitReturnReady idempotent/out-of-order guard cơ bản; chưa có test event với Huy. |
| QF-15 | REVIEW local | AP-019 summary theo ngày VN, history metrics booked/cancelled/checkedIn/completed và web summary; chưa có contract test riêng. |
| QF-16 | REVIEW local | Envoy route matrix + JWT filter local public key + public Catalog; chưa chạy `envoy --mode validate`/upstream smoke. |
| QF-17 | BLOCKED | Compose có Node API/worker, key readonly và dependency health; `docker compose config` dừng vì thiếu `rabbitmq/.env` và env Identity/Billing/Notification. |
| QF-18 | REVIEW local | Web session có userId/capabilities/tokenVersion/lease boundary, 401 redirect và polling cleanup; lease adapter thật của Hưng chưa nối. |
| QF-19 | REVIEW local | Profile list/search/create/edit và Schedule list/create/edit UI qua Gateway; cần review responsive/permission. |
| QF-20 | REVIEW local | DTO envelope mapping, stable idempotency key, polling cleanup/abort; web typecheck + test xanh. |
| QF-21 | REVIEW local | Cancel/reschedule form, expectedVersion, stable key, refund state hiển thị; refund source live chưa có. |
| QF-22 | DOING local | Reception queue FIRST/RETURN, call-next/no-show và conflict reload; check-in trực tiếp từ tìm hồ sơ chưa hoàn thiện. |
| QF-23 | DOING local | Clinical/Diagnostic feature đã được mount vào shell, thêm admin summary; cần Huy review runtime contract/lease. |
| QF-24 | REVIEW local | `.github/workflows/quan-node.yml` cho Node/Mongo/web/contracts; CI GitHub chưa chạy trong PR thật. |
| QF-25 | BLOCKED | Chưa có isolated Compose/E2E Gate 1–3 do thiếu env và producer live của Huy/Hưng. |
| QF-26 | DOING | Biên bản này + decision log đã tạo; chỉ đóng sau receiver rerun, commit/PR/CI và xác nhận liên owner. |

## Lệnh kiểm thử đã chạy

```text
services/appointment: npm run check                         PASS
services/appointment: npm test                             PASS (4/4)
services/appointment: npm run test:integration              PASS (12/12)
services/patient: npm run check                             PASS
tests/mongo: npm test                                       PASS (42/42)
apps/web: npm run typecheck                                 PASS
apps/web: npm test -- --maxWorkers=1                        PASS (8/8)
apps/web: npm run build                                     PASS
JSON: OpenAPI/message schema/Rabbit definitions parse        PASS
docker compose config                                       BLOCKED (missing local env files)
```

## File/scope chính đã bàn giao

- Auth: `services/appointment/src/auth/jwt-verifier.js`, `services/patient/src/auth/jwt-verifier.js`, middleware/main wiring.
- Appointment: queue/check-in/reschedule/cancel/schedule/summary, state history, settlement/clinical workers.
- Messaging: `services/appointment/src/workers/amqp-runtime.js`, `services/appointment/scripts/worker.js`, `services/patient/scripts/worker.js`, `rabbitmq/definitions.json`.
- Patient: CRUD/search và access outbox.
- Web: profile form, schedule admin, reception queue, appointment cancel/reschedule/polling, clinical/diagnostic/summary routes.
- CI: `.github/workflows/quan-node.yml`.

## Việc người nhận phải làm trước khi merge

1. Hưng cung cấp public-key/issuer/audience/tokenVersion/lease và Billing actual wire; chạy lại QF-02/QF-07/QF-08/QF-18.
2. Huy review pricing checkpoint, doctor mapping, ClaimQueueTicket/QueueTicketClaimed và VisitReturnReady; chạy QF-06/QF-13/QF-14/QF-23.
3. Tạo các env local theo owner, provision RabbitMQ `/umc-care`, chạy `docker compose config --quiet`, Envoy validate và broker smoke.
4. Chạy lại toàn bộ lệnh ở trên trong PR; chỉ sau đó chuyển tracker từ REVIEW/DOING sang INTEGRATED rồi DONE.
