# Shared HTTP/API

**Hưng** chủ trì shared transport/session và `src/app/runtime.ts`; Quân ghép shell, Huy/Quân dùng transport qua adapter của feature. Theo [phân công frontend 25/11/2026](../../../PHAN_CONG_VA_QUY_DINH_FRONTEND.md), nhiệm vụ U-09 và mục 6.

Hiện logic transport/refresh/lease nằm chủ yếu trong `runtime.ts`; thư mục này là phạm vi shared API, không phải bằng chứng đã có đủ client Billing/Notification. Client nghiệp vụ đặt tại `src/features/<service>/api.ts`, types cùng feature; không tạo HTTP client có token store riêng cho từng người.

- Request qua `/api/v1` và Gateway, gắn Bearer/lease theo hợp đồng backend.
- Đọc `data`/`error`/`meta.correlationId` đúng response; phân biệt 401 JWT, lease hết hạn, 403 thiếu quyền và 503 dependency/projection chưa sẵn sàng.
- Refresh đồng thời dùng cơ chế chung; logout/đổi tài khoản không giữ dữ liệu người cũ.
- Không tự retry thao tác ghi bằng khóa mới; cùng ý định giữ idempotency key, 409/version có xử lý tại feature.
- FE không nhận secret DB/RabbitMQ/Redis/private key. URL Gateway công khai không phải mật khẩu.

Thay đổi transport/envelope/auth cần các feature đang dùng review; Hưng chốt implementation, Quân chốt chỗ ghép shell.
