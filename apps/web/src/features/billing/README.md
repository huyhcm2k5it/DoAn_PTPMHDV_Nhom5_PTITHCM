# Billing frontend — Hưng

Backend owner: **Hưng — Billing**. Sau khi đồng bộ develop ngày 25/11/2026, feature đã có adapter `api.ts` và `types.ts`; `BookingReview` của Quân đã ghép thao tác Billing. `CashierQueueRoute` trong App vẫn là khung tĩnh, chưa phải màn thu ngân đầy đủ.

Nhiệm vụ còn lại theo [phân công thống nhất](../../../PHAN_CONG_VA_QUY_DINH_FRONTEND.md):

- **U-02:** thanh toán 04.01–04.09, OTHER, 04.02F/04.03F; nhận hold/appointment từ Quân, lấy charge/giá thật và polling. Người bệnh chọn tại quầy không gọi API CASHIER.
- **U-03:** queue/chi tiết khoản thu, thu tại quầy, biên nhận 09.01–09.04/09.08–09.11. Quân ghép component thay khung tĩnh.
- **U-04:** hoàn 09.05–09.07, bàn giao trạng thái cho màn 05 của Quân và LAB của Huy; đúng cancellation evidence, không hoàn trùng.
- **U-07:** báo cáo thu/hoàn/asOf cho 12.05 và khung tổng quan Quân.

Hoàn thiện component tại feature này dựa trên adapter/types đã có, tái dùng runtime/shared API Hưng. Không chuyển quyền sở hữu Appointment sang Billing vì màn 04 dùng cả hai service; BookingReview được hai owner bàn giao từng phần để giữ một luồng.

API đối chiếu tại [Billing OpenAPI](../../../../../contracts/http/billing.openapi.json). 202 chưa thành công; giữ trạng thái PENDING/IN_DOUBT tới khi server xác nhận, không tạo giao dịch khác khi chưa rõ kết quả. Chỉ hiện receipt sau server cấp ID; số tiền không lấy từ PDF.
