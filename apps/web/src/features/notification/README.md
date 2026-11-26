# Notification frontend — Hưng

Backend owner: **Hưng — Notification**. Tại thời điểm đối chiếu 25/11/2026, feature này **chỉ có README**, chưa có adapter/component frontend. ZIP mới có **21 biến thể “Thông báo đã đọc”**, nên phần trạng thái đã đọc không còn ghi chờ thiết kế; ZIP chưa có trang hộp thư độc lập hoàn chỉnh.

Nhiệm vụ **U-08**, phối hợp **Q-01**, tại [phân công thống nhất](../../../PHAN_CONG_VA_QUY_DINH_FRONTEND.md):

- Hưng tạo một adapter + component danh sách/popover + trạng thái đọc dùng chung; Quân gắn chuông vào shell.
- GET `/api/v1/notifications` theo tài khoản, filter `unreadOnly`, phân trang và `total`; PATCH `/api/v1/notifications/{notificationId}/read` rồi cập nhật trạng thái đọc sau thành công.
- Tổng chưa đọc lấy từ nguồn đầy đủ (ví dụ GET unreadOnly/total), không đếm riêng trang 1 rồi gọi tổng tất cả.
- Payload chủ yếu chứa subject ref như appointmentId/chargeId/orderId/prescriptionId. Resolve đúng tài nguyên và hồ sơ qua API hợp quyền trước khi mở page; không điều hướng tới URL tùy ý trong payload.
- Mọi biến thể PDF dùng cùng component; không đổi dữ liệu nghiệp vụ khi đánh dấu thông báo đã đọc, không lưu cờ đọc riêng cho từng page.

Dùng runtime/shared API của Hưng, dọn dữ liệu khi đổi tài khoản. API tham khảo [Notification OpenAPI](../../../../../contracts/http/notification.openapi.json).
