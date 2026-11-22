# HQH Care web

Frontend React/TypeScript dùng chung cho ba actor PATIENT, DOCTOR và STAFF. Phân công chi tiết theo frame tại [phân công frontend ba thành viên](../../docs/PHAN_CONG_FRONTEND_WEB_3_THANH_VIEN.md).

Quy định làm việc ngay trong thư mục web: [Phân công màn hình, thư mục và file chung](PHAN_CONG_VA_QUY_DINH_FRONTEND.md).

## Chạy Docker với env nhóm

Chạy project theo [hướng dẫn Docker chung](../../infra/compose/README.md) bằng đúng ba file env của nhóm. Web ở http://127.0.0.1:15173, phục vụ bằng Nginx và chuyển `/api/v1` về Gateway. API/worker dùng database, RabbitMQ, Redis online và cặp JWT hiện có của nhóm; không tạo bộ dữ liệu hoặc môi trường khác để thay thế.

## Phạm vi từng người

| Owner | Màn và chức năng                                                                                                       | Thư mục chính                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Quân  | Shell/sidebar/header/router; trang chủ, 02 hồ sơ, 03 đặt lịch, 05 lịch khám, 08 tiếp nhận, 11 nhà thuốc, 12 tổng quan  | `src/app/`, `src/features/patient/`, `appointment/`, `pharmacy/`, shared UI             |
| Huy   | 06 bàn khám, 07 chỉ định/kê đơn, 10 xét nghiệm; khối 05.06 kết quả LAB và 05.07 toa FINAL; Catalog                     | `src/features/clinical/`, `diagnostic/`, `catalog/`                                     |
| Hưng  | 01 tài khoản, 04 thanh toán, 09 thu ngân/hoàn tiền; JWT, lease, phiên và transport chung; Notification khi có thiết kế | `src/features/identity/`, `billing/`, `notification/`, `src/app/runtime.ts`, shared API |

Màn 05 vẫn do Quân phụ trách. Huy bàn giao `PublishedLabResults`, `MedicalHistory`, `SignedPrescription` để ghép; Hưng cung cấp phần thanh toán/hoàn tiền. Không làm thêm bản sao màn 05 trong feature riêng. Toa đã ký lấy từ Clinical; trạng thái cấp thuốc lấy từ Pharmacy.

## Phối hợp và tránh xung đột

- Người phụ trách feature sửa page, CSS, API client và test trong feature đó. Khi cần sửa phần của người khác, thống nhất phạm vi và ghi rõ trong PR.
- Quân chủ trì `src/app/App.tsx` và router/menu; Hưng chủ trì `src/app/runtime.ts` và shared HTTP/session. Huy cung cấp component, kiểu props, đường dẫn route, yêu cầu quyền và callback để tích hợp.
- File chung không có cơ chế khóa tự động. Hai người sửa cùng vùng code vẫn có thể conflict; thay đổi hai file khác nhau cũng có thể lệch props, route hoặc quyền. Cần review cả hành vi sau khi merge.
- Trước khi tích hợp, cập nhật bản `develop` mới nhất và kiểm tra diff trên nhánh đang làm. Giữ thay đổi chưa commit an toàn; không reset hoặc ghi đè phần của người khác để giải quyết conflict.
- Nếu conflict, đọc cả hai thay đổi, giữ chức năng của hai bên và chạy lại kiểm tra. Không chọn toàn bộ ours/theirs khi chưa đối chiếu.
- Lần tích hợp màn Huy hiện có thay đổi ở `App.tsx` (route, menu, API adapter) và `runtime.ts` (401 do lease hết hạn không đăng xuất nhầm phiên JWT). Hai phần này cần Quân/Hưng review khi gộp.

## Chạy và kiểm tra

Từ `apps/web`, chạy `npm ci`, rồi `npm run dev`. Vite mở tại `http://127.0.0.1:5173` và chuyển `/api/v1` tới Gateway `http://127.0.0.1:8080`. Đăng nhập thật cần Gateway và Identity đang chạy; từng nghiệp vụ còn cần API/worker tương ứng. Không đưa mật khẩu DB, RabbitMQ, Redis hoặc private key vào mã frontend.

Chạy `npm run typecheck`, `npm test`, `npm run build` trước khi gộp. Kiểm thủ công route/menu theo vai trò, thao tác giữa hai feature, hết phiên và đổi tài khoản. Quyền ADMIN không tự động thay vai trò DOCTOR/PATIENT hoặc bỏ quy tắc không tự duyệt LAB.

Dữ liệu mô phỏng Huy ở `tests/fixtures/huy-demo.json`, chỉ dành cho kiểm thử. Ứng dụng chính không tự dùng file này khi API lỗi. Test mô phỏng/build thành công chưa chứng minh tích hợp DB, JWT và RabbitMQ online đã hoàn tất. Phạm vi kiểm tra giao diện Huy hiện tập trung web desktop theo yêu cầu.

Xem [Clinical](src/features/clinical/README.md), [Diagnostic](src/features/diagnostic/README.md) và [runtime/shell](src/app/README.md) để biết đầu vào và luồng bàn giao.
