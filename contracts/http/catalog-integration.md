# Bàn giao Catalog tuần 1 — chưa tích hợp Gateway/Identity

Owner: Huy. Baseline sáu operation giữ method/path/permission API86 v5.2. Dùng `catalog.openapi.json`; file JSON thay tên `.yaml` trong plan, cùng chuẩn OpenAPI 3.1.1. Đây là ghi chú bàn giao trong repo, chưa gửi cho thành viên khác.

## Điểm cần Hưng/Quân ghép

1. Gateway route `/api/v1/departments`, `/doctors`, `/medical-services`, `/prices`, `/catalog/medicines`, `/catalog/lab-tests` đến Catalog. Không rewrite thành path khác, không inject role tự khai. Gateway vẫn do Hưng xây dựng.
2. Shared transport cho W03 trả `Promise<Response>`, thêm access token/lease vào đúng header, giữ `Idempotency-Key` caller đã tạo. Không tự tạo key mới khi retry POST. Shell nhận callbacks doctorId/serviceId cho màn chọn slot; ID Catalog khác Identity userId.
3. Cấu hình Identity verifier bằng public PEM: `JWT_PUBLIC_KEY_FILE`, `JWT_ISSUER`, `JWT_AUDIENCE`; cả ba phải có hoặc cùng bỏ trống (public-only). `LEASE_PUBLIC_KEY_FILE` có thể khác access key, mặc định dùng access public key. Private key không thuộc service Catalog và không commit.

## Contract xác thực tạm khóa cho implementation này

Access JWT RS256: `iss`, `aud`, `exp`, `iat` nếu có, `sub` UUID, `actorType` PATIENT/DOCTOR/STAFF, `capabilities` array string, `tokenVersion` integer. Issuer/audience phải đúng config. Code kiểm chữ ký, hạn, issued-at tương lai nếu claim có; lease bắt buộc có iat/exp. Không lấy quyền từ query/body/header role.

CA-004 thêm header `X-Authorization-Lease`: JWT RS256, cùng issuer/audience, `sub` và tokenVersion với bearer, `action:"CA-004"`, iat/exp và thời hạn tối đa 30 giây. Cần lease mới mỗi lần retry nếu lease trước hết hạn, giữ nguyên Idempotency-Key và body. **Tên claim/header này là lựa chọn nối tạm vì chưa có Identity implementation; Hưng cần đối chiếu trước khi tích hợp.** Không được nói auth live đã ghép.

Các protected operation đối chiếu `user_access_projection` cùng status ACTIVE, actor/tokenVersion và capabilities. Thiếu projection trả 503, sai quyền/revoked trả 403. Tuần 1 seed projection demo; tuần 2 nhận Identity event/checkpoint mới có cập nhật tự động. Không dùng projection seed làm dữ liệu người thật.

## Seed ID cho phát triển

| Loại | ID suffix (prefix UUID `00000000-0000-4000-8000-`) |
| --- | --- |
| Khoa Nội / Ngoại | `000000000001` / `000000000002` |
| Catalog doctorId | `000000000101` / `000000000102` |
| Identity doctor sub dự kiến | `000000000911` / `000000000912` |
| EXAM | `000000000201` / `000000000202` |
| MEDICINE / LAB | `000000000301` / `000000000401` |
| STAFF ADMIN / PHARMACY / LAB_TECH | `000000000901` / `000000000902` / `000000000903` |

Projection seed hiện có doctor 911; 912 chưa cấp quyền protected. Identity cần tạo account/projection phù hợp hoặc thống nhất mapping mới trước demo. Không hard-code tài khoản này vào production auth. Tên seed là dữ liệu học tập.

## Giá và event

- Half-open `[from,to)`; no current price => null. Không tự kết thúc giá vô hạn. Khoảng tương lai tối thiểu 5 phút, timestamp chính xác tối đa microsecond (quá mức trả 400), amount VND int64; frontend ghi trong giới hạn số nguyên an toàn JS.
- Response/idempotency cùng actor/key/canonical UTC body. Replay 201 không phát sinh price/outbox thứ hai. UI giữ key trong phiên form; thay phiên/refresh không thay thế API truy vết giao dịch sau này.
- Transaction ghi price + idempotency + sequence + outbox. Event đang lưu trong DB, **chưa publish RabbitMQ**. Exchange/routing đề xuất: `umc.events.catalog.v1` / `catalog.catalog-changed.v1`.
- Root envelope: messageId, messageKind EVENT, messageType CatalogChanged, schemaVersion 1, producer Catalog, aggregateId=itemId, aggregateVersion=price revision, correlationId/requestId/occurredAt. Payload: entityType PRICE_VERSION, entityId=priceVersionId, entityVersion, fullSnapshot Price, effectiveAt, streamSequence, mode UPSERT.
- `PRICE_VERSION` và event envelope phải chốt với consumer tuần 2; chưa có event JSON Schema chính thức hoặc consumer compatibility test. Không dùng field này để tuyên bố đã đồng bộ Billing/Appointment.

## Trạng thái bàn giao

Standalone Go/PostgreSQL và W03 có thể phát triển/test độc lập. Chưa ghép: Envoy, Identity live/lease issuance/access projection delivery, shell/shared transport, luồng login → hồ sơ → slot, RabbitMQ publisher/consumer, Redis. Dockerfiles/Compose/CI đã định nghĩa; Docker runtime và GitHub CI phải xác minh khi môi trường sẵn. Không tính technical health endpoint vào sáu operation nghiệp vụ.
