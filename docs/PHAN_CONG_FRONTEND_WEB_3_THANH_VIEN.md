# Phân công frontend web HQH Care cho 3 thành viên

Bản phân công cũ ngày 20/11/2026 đã được thay bằng bản **25/11/2026** đối chiếu **138 PDF của `HQH_Care_web.zip`**, frontend hiện có và backend từng người.

**Đọc bản thống nhất trong frontend: [Phân công màn hình, file, API và việc còn lại](../apps/web/PHAN_CONG_VA_QUY_DINH_FRONTEND.md).** Hướng dẫn chạy ở [README web](../apps/web/README.md).

Các điểm cần áp dụng:

- Quân giữ Patient/Appointment/Pharmacy, shell/router, màn cha 05, 12.02 và khung tổng quan.
- Huy giữ Catalog/Clinical/Diagnostic; 05.06/05.07 là trang riêng dùng chung điều hướng với 05; thêm 06.05/06.06/06.07/06.10, 12.01/12.06 theo thiết kế mới.
- Hưng giữ Identity/Billing/Notification, thanh toán/thu ngân/hoàn; 12.03 quyền, 12.04 audit, phần Billing 12.05; runtime/shared API.
- 21 bản thông báo đã đọc dùng chung component Hưng trong shell Quân, không nhân bản page và không ghi trạng thái này còn chờ thiết kế.
- Danh sách đủ từng PDF, source đã có, phần thiếu, task Q/H/U/B, thứ tự làm và tiêu chí nghiệm thu đều nằm ở bản frontend. Không duy trì thêm bảng phân công song song tại đây để tránh lệch.

Tài liệu phân công chưa xác nhận code đã chạy đúng hoặc đã kiểm thử online. Các PDF minh họa không phải dữ liệu thật của hệ thống.
