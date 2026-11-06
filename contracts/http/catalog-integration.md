# Catalog API and integration contract

The six operations preserve the API86 v5.2 method/path/permission baseline. `catalog.openapi.json` is the OpenAPI 3.1.1 machine-readable contract.

## Điểm cần Hưng/Quân ghép

1. Gateway route `/api/v1/departments`, `/doctors`, `/medical-services`, `/prices`, `/catalog/medicines`, `/catalog/lab-tests` đến Catalog. Không rewrite thành path khác, không inject role tự khai. Gateway vẫn do Hưng xây dựng.
2. Shared transport cho W03 trả `Promise<Response>`, thêm access token/lease vào đúng header, giữ `Idempotency-Key` caller đã tạo. Không tự tạo key mới khi retry POST. Shell nhận callbacks doctorId/serviceId cho màn chọn slot; ID Catalog khác Identity userId.
3. Cấu hình Identity verifier bằng public PEM: `JWT_PUBLIC_KEY_FILE`, `JWT_ISSUER`, `JWT_AUDIENCE`; cả ba phải có hoặc cùng bỏ trống (public-only). `LEASE_PUBLIC_KEY_FILE` có thể khác access key, mặc định dùng access public key. Private key không thuộc service Catalog và không commit.

## Contract xác thực tạm khóa cho implementation này

Access JWT RS256: `iss`, `aud`, `exp`, `iat` nếu có, `sub` UUID, `actorType` PATIENT/DOCTOR/STAFF, `capabilities` array string, `tokenVersion` integer. Issuer/audience phải đúng config. Code kiểm chữ ký, hạn, issued-at tương lai nếu claim có; lease bắt buộc có iat/exp. Không lấy quyền từ query/body/header role.

CA-004 thêm header `X-Authorization-Lease`: JWT RS256, cùng issuer/audience, `sub` và tokenVersion với bearer, `action:"CA-004"`, iat/exp và thời hạn tối đa 30 giây. Cần lease mới mỗi lần retry nếu lease trước hết hạn, giữ nguyên Idempotency-Key và body. Identity/Gateway phải cấp đúng claim và header này trong shared runtime trước khi xem auth live là đã ghép.

Các protected operation đối chiếu `user_access_projection` cùng status ACTIVE, actor/tokenVersion và capabilities. Thiếu projection trả 503, sai quyền/revoked trả 403. Worker nhận IdentityAccessChanged và áp dụng theo source version; cùng version nhưng khác nội dung bị quarantine. Projection seed chỉ dành cho demo, không phải dữ liệu người thật.

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
- Transaction ghi price + idempotency + sequence + outbox. Catalog worker phát durable outbox qua RabbitMQ publisher confirms và phát checkpoint định kỳ. Exchange/routing chuẩn: `umc.events.catalog.v1` / `catalog.catalog-changed.v1`.
- Root envelope: messageId, messageKind EVENT, messageType CatalogChanged, schemaVersion 1, producer `catalog`, aggregateId, aggregateVersion, correlationId/requestId/occurredAt. Payload dùng full snapshot cho `UPSERT`/`TOMBSTONE` và watermark cho `CHECKPOINT`; JSON Schema có tại `../messages/catalog.v1.schema.json`.
- PostgreSQL, RabbitMQ và Redis adapter tests chạy trong CI, gồm kiểm tra ACL Redis scoped, stream sequence/checkpoint và event envelope. Đây là bằng chứng của adapter Catalog; nó không chứng minh các dịch vụ Appointment/Billing hoặc Gateway đã được ghép.

## Trạng thái bàn giao

Catalog runs independently with PostgreSQL, RabbitMQ and Redis adapters. Shared Gate 3 still depends on Gateway routes/shared transport and live Identity lease issuance, plus the Appointment/Billing end-to-end journey. Technical health endpoints are separate from the six business operations.

## Canonical CatalogChanged v1 contract

`../messages/catalog.v1.schema.json` defines full-snapshot UPSERT/TOMBSTONE and STREAM CHECKPOINT events. New envelopes use `producer="catalog"`, exchange `umc.events.catalog.v1` and routing key `catalog.catalog-changed.v1`. A consumer may accept producer `Catalog` and legacy routing alias `catalog.changed.v1` only while old persisted deliveries drain; publishers must not create new uppercase events. `entityVersion` and envelope `aggregateVersion` are monotonic for an entity; `streamSequence` orders the shared feed. A consumer may not clear an observed gap by applying a later checkpoint.
