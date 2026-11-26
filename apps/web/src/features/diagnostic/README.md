# Không gian xét nghiệm — Huy

Route `/staff/diagnostic` triển khai nhóm 10 của Web UI. DiagnosticFeature nhận API, phiên Identity và tùy chọn bản đồ nhân khẩu patients có nguồn hợp lệ. Chỉ STAFF có LAB_TECH/LAB_REVIEW tải hàng chờ; backend quyết định quyền từng request.

## Luồng và API

| Thao tác           | Điều kiện trên màn                                                                          | API                                       |
| ------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Danh sách/chi tiết | Phiên xét nghiệm                                                                            | DI-002/003, lọc trạng thái đơn/phân trang |
| Lấy mẫu            | LAB_TECH, order PAID, chargeState PAID                                                      | DI-004                                    |
| Từ chối mẫu        | COLLECTED mới nhất, chưa có result, có lý do                                                | DI-005, expectedVersion của mẫu           |
| Lấy lại mẫu        | SPECIMEN_REJECTED, đã trả tiền                                                              | DI-006, cùng order, không thu phí mới     |
| Nhập/sửa kết quả   | LAB_TECH, DRAFT/REWORK, mẫu hợp lệ                                                          | DI-007/008                                |
| Gửi duyệt          | Đã lưu đủ chỉ số, không còn thay đổi chưa lưu                                               | DI-009                                    |
| Yêu cầu làm lại    | LAB_REVIEW, REVIEW, lý do bắt buộc                                                          | DI-010                                    |
| Công bố            | LAB_REVIEW, REVIEW, người duyệt độc lập                                                     | DI-011                                    |
| Hủy                | Bác sĩ được phép, chưa từng lấy mẫu, chưa thu hoặc đã thu xong, không settlement đang xử lý | DI-012 trong CancelLabDialog              |
| Xem kết quả        | Bác sĩ/bệnh nhân được backend cấp quyền                                                     | DI-013, chỉ PUBLISHED                     |

REVIEW/REWORK là trạng thái result tại chi tiết, không gửi làm bộ lọc order DI-002. Thanh toán lấy từ Diagnostic projection của Billing; không tự đánh dấu đã thu để mở lấy mẫu. Làm mới tải hàng chờ; chi tiết cập nhật định kỳ, tạm dừng khi có nội dung chưa lưu hoặc write chưa xác định kết quả.

DI-007/008 gửi testCode/valueText/flag theo snapshot chỉ định. Đơn vị/tham chiếu hiển thị từ snapshot; server xác minh và gắn vào kết quả. Không tự tạo chỉ số, kết quả hay khoảng tham chiếu. Gửi duyệt chưa công bố; chỉ DI-011 trả PUBLISHED mới hiển thị đã công bố.

Màn chặn userId bằng enteredBy tự duyệt. Backend còn kiểm tra toàn bộ contributors (người sửa/gửi duyệt); API hiện chưa trả toàn bộ danh sách này. Quyền cuối cùng do server quyết định; 403 phải hiển thị lỗi và giữ dữ liệu.

CANCELLED chỉ đọc. refundStatus từ DI-002: NOT_REQUIRED/PENDING_SYNC/REQUESTED/FAILED/SUCCEEDED. Chỉ SUCCEEDED hiển thị đã hoàn tiền; không tự thay trạng thái hoặc dựng kết quả để đóng luồng.

## Adapter và phiên

```tsx
const api = createDiagnosticApi(runtime.transport, {
  authorizationLease: runtime.session?.lease,
});
<DiagnosticFeature api={api} session={runtime.session} />;
```

DI-008/009/011/012/013 dùng lease đúng action. DI-007/010 không bị adapter áp đặt lease ngoài hợp đồng hiện tại. Mỗi write có Idempotency-Key; retry giữ key/body, chỉ làm mới lease. 409 cần xử lý phiên bản; bản poll cũ không thay kết quả mới vừa lưu. Write chưa rõ kết quả khóa sửa và chuyển chỉ định.

PublishedLabResults bàn giao khối 05.06; ResultTable dùng chung bảng. Bệnh nhân chỉ thấy PUBLISHED với giá trị, đơn vị, tham chiếu và in. JWT do transport chung của Hưng cung cấp; không có bí mật backend hoặc kết nối trực tiếp DB/RabbitMQ/Redis trong feature.

DI-002/003 chưa có tên bệnh nhân, dị ứng, sinh hiệu. Khi host chưa cung cấp dữ liệu có quyền, màn hiện mã hồ sơ; không dựng thông tin theo PDF. Kiểm thử ở `apps/web/tests/huy-workspaces.test.tsx` và `apps/web/tests/huy-treatment-regression.test.tsx`. Chạy online cần tài khoản, grant/projection và dữ liệu thật; fixture UI không thay thế nghiệm thu tích hợp.

## Đối chiếu 25/11/2026

DI-012 theo review backend: cho hủy trước khi thu nếu chưa có mẫu và không có settlement đang xử lý. NOT_REQUIRED nghĩa không có khoản hoàn, không khẳng định viện phí đã đóng charge. Event có sourceRevision đúng nguồn; Billing mới nhất đã có consumer void/refund và xử lý cancellation tới trước charge. Giữ guard bác sĩ/lease/version/idempotency và không hủy nếu từng có mẫu REJECTED. Chỉ API/worker lấy dữ liệu online; không có runtime seed demo.
