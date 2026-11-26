# Điều phối router frontend HQH Care

Cập nhật 25/11/2026 sau đồng bộ develop. Bản phân công thống nhất nằm tại [PHAN_CONG_VA_QUY_DINH_FRONTEND.md](../../../PHAN_CONG_VA_QUY_DINH_FRONTEND.md), hướng dẫn chạy ở [README web](../../../README.md).

- Quân chủ trì App.tsx, menu, router, shell và shared UI; Hưng chủ trì runtime/shared API; mỗi owner giữ feature của mình.
- Huy giữ Catalog/Clinical/Diagnostic, 05.06/05.07, 06/07/10 và giá 12.01/12.06. `/staff/prices` dùng PriceVersionsPage; `/catalog` giữ tra cứu hiện có.
- Develop đã có AppointmentRecords/tab lịch của Quân. Trang kết quả/toa theo hồ sơ của Huy vẫn dùng route riêng với patientId và đường quay lại.
- Hưng giữ Identity/Billing/Notification; báo cáo/quyền/audit chia theo backend. Biến thể thông báo đã đọc dùng component chung, không còn ghi phần trạng thái đó chờ thiết kế.
- Một router và một phiên xác thực chung; mã frame PDF là trạng thái, không là route riêng. Quyền cuối cùng do backend kiểm.
- Dùng ứng dụng/Compose chung và ba env của nhóm, DB/RabbitMQ/Redis online. Không tạo hay dùng stack test/seed giả riêng để thay luồng thật.

Các nhiệm vụ Q/H/U/B, file/API, phần đã có/còn lại và checklist đủ 138 PDF đều nằm ở tài liệu phân công chính; không giữ bảng phân công thứ hai có thể lệch tại đây. Khi đổi route/props, owner feature và Quân phải kiểm cả đường đi/đường về, deep link, quyền và hồ sơ đang chọn.
