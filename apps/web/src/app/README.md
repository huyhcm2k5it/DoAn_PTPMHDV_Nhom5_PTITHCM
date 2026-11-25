# Shell và router web

**Quân** chủ trì `App.tsx`, menu/header/layout, CSS shell và việc ghép route/component của ba người. **Hưng** chủ trì `runtime.ts`: session, token/refresh, lease và transport. Phân công thống nhất tại [tài liệu frontend](../../PHAN_CONG_VA_QUY_DINH_FRONTEND.md), nhiệm vụ Q-01/Q-05/Q-08 và U-09.

`App` nhận runtime được truyền qua props hoặc lấy từ cơ chế runtime hiện có; các feature dùng transport/session chung. Runtime hiện đã có login, refresh, logout và lưu phiên theo lựa chọn người dùng; không tạo thêm session store trong feature. Backend vẫn kiểm quyền thực tế, FE kiểm quyền để điều hướng và phản hồi cho người dùng.

## Tích hợp còn lại

- Q-05: nối tab/nút lịch khám → kết quả LAB/toa đã ký → quay lại, giữ hồ sơ và mapping lịch/visit khi có nguồn. Hai route Huy là trang riêng phù hợp ZIP mới.
- U-03 + Q-01: Hưng bàn giao component thu ngân có API để thay `CashierQueueRoute` đang là khung tĩnh.
- Q-08 + H-07 + U-05/U-06/U-07: ghép quản trị giá/ca/quyền/audit/báo cáo theo đúng owner; route đề xuất trong phân công chưa có nghĩa đã được khai báo.
- U-08 + Q-01: dùng một chuông/trạng thái thông báo đã đọc chung, không sao chép từng page theo PDF.
- Các route Patient/Appointment/Pharmacy, Catalog/Clinical/Diagnostic và page Identity đã có. Nhóm 03 đã có code chọn slot/hold và 04 đã có tạo appointment; không coi là chỉ tra cứu slot, cũng không coi tạo appointment là đã thu tiền.

Owner feature gửi component, kiểu props, API adapter, capability, callback/route và tiêu chí kiểm tra cho Quân. Chưa có adapter/server phải thể hiện lỗi kết nối hoặc phần chờ hoàn thiện, không tự dùng fixture và phiên giả.
