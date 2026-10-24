# W03 — Huy sở hữu phần danh mục

Component React/TypeScript độc lập với router và auth provider. Không sửa app shell, shared UI, login hoặc API client do Quân/Hưng phụ trách.

```tsx
const catalog = createCatalogApi(sharedTransport); // (url, RequestInit) => Promise<Response>
<CatalogPage api={catalog} session={session}
  onChooseDoctor={doctorId => navigateToSlots({ doctorId })}
  onChooseService={medicalServiceId => navigateToSlots({ medicalServiceId })} />
```

Giữ `api`/`session` ổn định bằng useMemo/provider. Shared transport thêm bearer và lease CA-004 hiện tại vào POST; phải trả Response nguyên bản, không bóc envelope trước adapter. Không tự retry POST với key mới. Router/menu/app shell do owner ghép sau.

- Public: chuyên khoa, bác sĩ có phân trang/lọc khoa, dịch vụ và giá hiệu lực.
- DOCTOR: thêm danh mục thuốc/xét nghiệm. STAFF: PHARMACY cho thuốc; LAB_TECH/LAB_REVIEW cho test; ADMIN được cả hai và tạo giá.
- ADMIN tạo giá cho nhóm đang xem; tiền VND nguyên an toàn với JS; ngày giờ nhập theo múi giờ máy và gửi ISO UTC. Backend kiểm thêm quyền/lease, item active và giá chồng.
- Giá null hiển thị chưa có giá, không biến thành 0; giá không phải báo giá Billing. Không hiển thị tồn kho.
- Request cũ bị abort và bỏ kết quả nếu trả muộn. Loading/empty/error/manual retry, 401/403/409 và correlation ID có thông báo.
- Form chặn double submit. Cùng nội dung thử lại dùng cùng Idempotency-Key; sửa nội dung là ý định mới. Không tự gửi lại khi mạng lỗi.
- Callback chỉ chuyển ID danh mục cho Appointment; không tự tạo lịch.

Tests nằm trong preview riêng do shell chưa có package.json. Chạy lệnh tại `tools/catalog-preview/README.md`; khi ghép shell chuyển bộ test này vào runner chung. Scope CSS `.umc-catalog`, responsive 700px và giảm chuyển động theo thiết lập hệ điều hành.
