# Quân — decision log backlog v3 — 05/11/2026

Tài liệu này ghi các quyết định kỹ thuật đã dùng trong bản local hiện tại. Những mục có owner khác chưa xác nhận được giữ trạng thái OPEN, không coi là contract đã chốt.

| Mã | Quyết định local | Trạng thái |
| --- | --- | --- |
| D-AUTH | Appointment/Patient dùng RS256, issuer `umc-care-identity`, audience `umc-care-services`, claim `sub/actorType/capabilities/tokenVersion`; thiếu public key hoặc projection ACTIVE/version thì protected API fail-closed. | REVIEW với Hưng |
| D-QUEUE | AP-015 yêu cầu `expectedVersion`; AP-017 yêu cầu `ticketType`; queue rỗng trả `409 QUEUE_EMPTY`; call-next ghi ticket và idempotency trong một Mongo transaction. | REVIEW local |
| D-SETTLEMENT | `ReserveSettlement` là command từ Billing tới Appointment; Appointment cấp fence và phát `SettlementReserved`; local state dừng ở lock nếu chưa có Billing wire thật. | OPEN với Hưng |
| D-RETURN | `VisitReturnReady` tạo đúng một ticket RETURN theo `appointmentId + returnRound`, giữ `visitId`; không tạo charge mới. | OPEN với Huy |
| D-PRICING | doctor/service/price chỉ lấy từ hold hoặc projection cục bộ; không nhận mapping đáng tin từ browser. | OPEN với Huy |
| D-GATEWAY | Envoy route theo owner, JWT RS256 local public key; Catalog được allow-missing, các route nghiệp vụ yêu cầu JWT. | REVIEW với Hưng |
| D-INFRA | RabbitMQ dùng vhost `/umc-care`; Appointment/Patient có worker riêng, confirm + mandatory, retry 5/15/60 giây và quarantine. | REVIEW topology; chưa smoke live |

## Quy ước evidence

- Không commit private key hoặc file `.env` thật.
- `DONE` chỉ được ghi sau khi receiver chạy lại, CI xanh và có evidence live tương ứng.
- Compose hiện chưa thể chạy sạch tại máy này vì thiếu `rabbitmq/.env` và `.env` của Identity/Billing/Notification; không tự tạo secret thay owner.
