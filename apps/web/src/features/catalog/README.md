# W03 — Huy sở hữu phần danh mục

Component React/TypeScript độc lập với router và auth provider. Không sửa app shell, shared UI, login hoặc API client do Quân/Hưng phụ trách.

```tsx
const catalog = createCatalogApi(sharedTransport, {
  authorizationLease: session?.lease,
}); // (url, RequestInit) => Promise<Response>
<CatalogPage
  api={catalog}
  session={session}
  onChooseDoctor={(doctorId) => navigateToSlots({ doctorId })}
  onChooseService={(medicalServiceId) => navigateToSlots({ medicalServiceId })}
/>;
```

Giữ `api`/`session` ổn định bằng useMemo/provider. Shared transport thêm bearer; adapter Catalog lấy lease CA-004 mới qua callback khi POST; phải trả Response nguyên bản, không bóc envelope trước adapter. Không tự retry POST với key mới. Router/menu/app shell do owner ghép sau.

- Public: chuyên khoa, bác sĩ có phân trang/lọc khoa, dịch vụ và giá hiệu lực.
- DOCTOR: thêm danh mục thuốc/xét nghiệm. STAFF: PHARMACY cho thuốc; LAB_TECH/LAB_REVIEW cho test; ADMIN được cả hai và tạo giá.
- ADMIN tạo giá cho nhóm đang xem; tiền VND nguyên an toàn với JS; ngày giờ nhập theo múi giờ máy và gửi ISO UTC. Backend kiểm thêm quyền/lease, item active và giá chồng.
- Giá null hiển thị chưa có giá, không biến thành 0; giá không phải báo giá Billing. Không hiển thị tồn kho.
- Request cũ bị abort và bỏ kết quả nếu trả muộn. Loading/empty/error/manual retry, 401/403/409 và correlation ID có thông báo.
- Form chặn double submit. Cùng nội dung thử lại dùng cùng Idempotency-Key; sửa nội dung là ý định mới. Không tự gửi lại khi mạng lỗi.
- Callback chỉ chuyển ID danh mục cho Appointment; không tự tạo lịch.

Kiểm thử nằm trong `apps/web/tests/huy-catalog-api.test.ts`, `huy-catalog-regression.test.tsx` và `catalog.test.tsx`. Chạy bằng runner chung của `apps/web`. Scope CSS `.umc-catalog`, responsive 700px và giảm chuyển động theo thiết lập hệ điều hành.

## Phiên bản giá 12.01 / 12.06

`PriceVersionsPage` tại `/staff/prices` dành cho STAFF ADMIN, tái dùng PriceForm. `PriceHistory` đọc GET `/api/v1/prices` (CA-007), lọc itemType/itemId, phân trang cả quá khứ/hiện tại/tương lai. Mỗi request kiểm ADMIN từ token và projection hiện tại; không đọc lịch sử từ cache public hoặc localStorage. POST giữ cùng intent/key khi retry nhưng lấy lease mới; sau tạo chỉ reload bảng lịch sử, giữ phản hồi lưu thành công trong form. Dữ liệu là từ Catalog DB online hiện có; không seed runtime hoặc thay lịch sử giá cũ.
