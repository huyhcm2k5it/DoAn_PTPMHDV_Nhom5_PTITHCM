# Hồ sơ bàn giao UMC Care cho nhóm Huy Quân Hưng

**Mục đích:** gom hướng dẫn, quy định đang áp dụng, trạng thái đã có bằng chứng và checklist bàn giao để ba thành viên cùng tra cứu.

**Cập nhật:** 25/10/2026. Nội dung về tiến độ được đối chiếu với source trong repository và `tools/huy/VERIFICATION.md`. Trạng thái trên GitHub/CI, quyền tài khoản, tiến độ code của Quân/Hưng và demo tích hợp chỉ được xác nhận khi có kết quả/link kiểm tra tương ứng.

## Đọc theo thứ tự

1. [Phạm vi và đầu mối của ba người](PHAM_VI_VA_DAU_MOI.md)
2. [Quy định chung khi code, review và bàn giao](QUY_DINH_CHUNG.md)
3. [Phần Huy đã làm và trạng thái bàn giao](HUY_DA_LAM_VA_CHO_BAN_GIAO.md)
4. [Checklist nhận và giao từng task](CHECKLIST_BAN_GIAO.md)
5. [Hướng dẫn hoàn thành toàn bộ task còn lại của Huy](../HUY_HUONG_DAN_HOAN_THANH_TOAN_BO_TASK.md)
6. [Phụ lục 30 API cùng message liên quan](../HUY_PHU_LUC_30_API_VA_MESSAGE.md)

## Tài liệu chuẩn đang có

- [Quy định GitHub và phân quyền thư mục lập ngày 24/10](../QUY_DINH_GITHUB_NHOM5_HUY_QUAN_HUNG_20261024.md): nguồn quy tắc chi tiết về nhánh, review, owner và conflict.
- [Lịch triển khai 19/10–23/11](../UMC_Care_Phan_Cong_Lich_Trien_Khai_3_Nguoi_20261019.docx): kế hoạch chung tham khảo; tình hình thực tế phải theo commit, review, CI và demo.
- [Phân công và quy ước 19/10](../UMC_Care_Phan_Cong_Va_Quy_Uoc_Chung_3_Nguoi_20261019.docx): bảng phạm vi/luồng bàn giao. Quy trình Git cũ trong Word đã được thay bằng quy định 24/10.
- [BRD](../UMC_Care_BRD_9_Service_v5_20261017.md), [SRS](../UMC_Care_SRS_9_Service_v5_20261017.md), [UC](../UMC_Care_UC_9_Service_v5_20261017.md), [ERD](../UMC_Care_ERD_9_Service_v5_20261017.md): baseline nghiệp vụ.
- [Kiểm chứng Huy](../../tools/huy/VERIFICATION.md): lệnh/kết quả local đã ghi và những giới hạn tích hợp còn lại tại lần kiểm chứng.
- [Bàn giao Catalog](../../contracts/http/catalog-integration.md): điểm cần Quân/Hưng ghép và hợp đồng nối hiện tại.

## Quy tắc cập nhật hồ sơ

- Ghi trạng thái bằng chứng, không đánh dấu Done theo dự kiến trong lịch.
- Khi có thay đổi, ghi task/API, commit/PR, người review, lệnh chạy và kết quả; người nhận xác nhận đã chạy lại.
- Nếu nguồn hợp đồng chưa thống nhất, mở issue và ghi quyết định có owner trước khi code phần phụ thuộc.
- Không ghi password, token, OTP, dữ liệu bệnh nhân hoặc `.env` vào hồ sơ bàn giao.
