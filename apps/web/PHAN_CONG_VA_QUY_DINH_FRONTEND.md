# Phân công màn hình và quy định file frontend HQH Care

Phạm vi: web React/TypeScript trong `apps/web`. Đây là quy định phối hợp chung của Quân, Huy và Hưng. Phân công không đồng nghĩa màn đã nghiệm thu; trạng thái hoàn thành phải có bằng chứng kiểm thử. Các mã 06.01, 07.01… là trạng thái của màn, không yêu cầu tạo từng route riêng.

## 1. Người phụ trách từng màn

| Màn thiết kế                | Người phụ trách chính          | Phạm vi và phần bàn giao                                                                                                    |
| --------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Trang chủ bệnh nhân         | Quân                           | Trang chủ, chưa có lịch, điều hướng đặt lịch/hồ sơ                                                                          |
| 01 · Tài khoản              | Hưng                           | Đăng nhập bệnh nhân/bác sĩ/nhân viên, đăng ký, OTP, quên/đổi mật khẩu, lỗi và hết phiên                                     |
| 02 · Hồ sơ của tôi          | Quân                           | Danh sách, xem, tạo, sửa hồ sơ; kiểm quyền theo chủ hồ sơ                                                                   |
| 03 · Đặt lịch khám          | Quân                           | Chuyên khoa, bác sĩ, dịch vụ, slot và giữ chỗ; Huy cung cấp Catalog                                                         |
| 04 · Xác nhận và thanh toán | Hưng                           | Nhận lựa chọn lịch từ Quân, khoản thu, phương thức, trạng thái chờ/thất bại/thành công/hết hạn                              |
| 05 · Lịch khám của tôi      | Quân                           | Danh sách/chi tiết lịch, 05.01–05.05 và 05.08; ghép các khối do Huy/Hưng cung cấp                                           |
| 05.06 · Kết quả LAB         | Huy làm khối, Quân ghép vào 05 | `PublishedLabResults`; chỉ kết quả PUBLISHED từ Diagnostic                                                                  |
| 05.07 · Toa thuốc đã ký     | Huy làm khối, Quân ghép vào 05 | `MedicalHistory`/`SignedPrescription`; chỉ toa FINAL từ Clinical. Tình trạng cấp thuốc lấy Pharmacy của Quân                |
| 06 · Bàn khám bác sĩ        | Huy                            | 06.01 nhận FIRST đang chờ; 06.02 khám lần đầu; 06.03 nhận RETURN đang chờ; 06.04 mở lại lượt cũ; bản nháp, lịch sử, kết quả |
| 07 · Chỉ định và kê đơn     | Huy                            | 07.01–07.09: LAB, chặn ký, toa nháp, hủy LAB, ký khám/ký toa riêng, trạng thái đã ký/chỉ đọc                                |
| 08 · Tiếp nhận bệnh nhân    | Quân                           | 08.01–08.04: check-in, cấp/gọi vé FIRST/RETURN, nhận lại đúng lượt; bàn giao ticket/version/doctorId cho Huy                |
| 09 · Thu ngân và viện phí   | Hưng                           | 09.01–09.11: thu khám/LAB/thuốc, chờ/thất bại/thành công, biên nhận và hoàn tiền                                            |
| 10 · Không gian xét nghiệm  | Huy                            | 10.01–10.07: mẫu, nháp, gửi duyệt, người duyệt độc lập, chặn tự duyệt, làm lại và công bố                                   |
| 11 · Cấp phát thuốc         | Quân                           | 11.01–11.06: tồn kho, giữ đủ toa, hạn giữ, chờ phí, cấp phát và hết hạn                                                     |
| 12 · Tổng quan bệnh viện    | Quân                           | Bộ lọc và số liệu theo nguồn; Hưng cấp số liệu thu/hoàn; không tự cộng các chỉ số khác nghĩa                                |
| Thông báo                   | Hưng                           | Feature Notification; phối hợp Quân vị trí mở từ shell, chờ thiết kế nếu chưa có frame                                      |

Các chức năng quản trị giữ theo service: Catalog/giá do Huy, ca khám và báo cáo Appointment do Quân, quyền nhân viên/audit/báo cáo Billing do Hưng. ADMIN không tự thay vai trò DOCTOR/PATIENT; nghiệp vụ vẫn kiểm capability và phạm vi riêng.

## 2. Thư mục và file do từng người chủ trì

Đường dẫn trong bảng tính từ `apps/web/`. Chủ trì là đầu mối tích hợp/review, không phải khóa file tự động.

| File hoặc thư mục                                                      | Chủ trì               | Quy định                                                                                                         |
| ---------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/features/patient/**`                                              | Quân                  | Page, API client, types và CSS Patient                                                                           |
| `src/features/appointment/**`                                          | Quân                  | Đặt lịch, tiếp nhận, ca khám, tổng quan                                                                          |
| `src/features/pharmacy/**`                                             | Quân                  | Kho, cấp thuốc và trạng thái thuốc bệnh nhân                                                                     |
| `src/features/catalog/**`                                              | Huy                   | Danh mục, phiên bản giá, API/types phục vụ các màn khác                                                          |
| `src/features/clinical/**`                                             | Huy                   | Bàn khám, treatment, bệnh án/toa và component bàn giao                                                           |
| `src/features/diagnostic/**`                                           | Huy                   | Mẫu/kết quả LAB, hủy, khối kết quả công bố                                                                       |
| `src/features/identity/**`                                             | Hưng                  | Các page và thành phần tài khoản                                                                                 |
| `src/features/billing/**`                                              | Hưng                  | Thanh toán, thu ngân, biên nhận, hoàn tiền                                                                       |
| `src/features/notification/**`                                         | Hưng                  | Danh sách/chi tiết/trạng thái thông báo theo thiết kế                                                            |
| `src/app/App.tsx`                                                      | Quân                  | Router/menu/ghép page. Huy/Hưng bàn giao component và yêu cầu quyền; thay đổi tích hợp cần review cùng owner     |
| `src/app/app.css`, `src/app/quan-workflow.css`                         | Quân                  | CSS shell và luồng Quân. Không thêm selector toàn cục để sửa riêng một feature                                   |
| `src/app/runtime.ts`, `src/shared/api/**`                              | Hưng                  | JWT, refresh, lease, logout, transport và xử lý hết phiên dùng chung                                             |
| `src/shared/ui/**`                                                     | Quân                  | Component dùng chung; thay đổi props/CSS phải kiểm các màn đang dùng                                             |
| `src/main.tsx`, `index.html`, `public/**`                              | Quân                  | Bootstrap và tài nguyên chung. Asset feature cần tên/thư mục nhận diện owner                                     |
| `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json` | Quân điều phối        | Thống nhất dependency/config trước khi sửa; hai file package phải khớp, kiểm cả ứng dụng                         |
| `tests/*`                                                              | Theo feature          | Quân: patient/booking/pharmacy; Hưng: login/registration/password; Huy: `huy-*.test.*`, `fixtures/huy-demo.json` |
| `README.md`, file phân công này                                        | Cả ba, Quân điều phối | Ghi thống nhất cách chạy và trách nhiệm; README trong mỗi feature do owner giữ                                   |

File mới của Huy: `ClinicalRoute.tsx`, `ClinicalUI.tsx`, `DraftEditor.tsx`, `TreatmentPanel.tsx`, `LeaveGuard.tsx`, `useMutation.ts`, `MedicalHistory.tsx`, `PatientRecordsRoute.tsx`, `workspace.css` trong Clinical; `ResultEditor.tsx`, `CancelLabDialog.tsx`, `PublishedLabResults.tsx` trong Diagnostic. Đây là component nghiệp vụ Huy, chưa chuyển thành shared UI chung.

## 3. Đầu vào/đầu ra tại các điểm ghép

| Điểm ghép      | Bên giao | Bên nhận | Hợp đồng cần giữ                                                                                                   |
| -------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| 03 → 04        | Quân     | Hưng     | Appointment/hold ID, hồ sơ, dịch vụ/slot và snapshot đã được server xác nhận                                       |
| 08 → 06        | Quân     | Huy      | `ticketId`, `doctorId`, `expectedTicketVersion`; FIRST/RETURN do backend xác minh, không tạo lượt mới khi khám lại |
| 07 → 09 → 10   | Huy/Hưng | Hưng/Huy | LAB order/charge và trạng thái đồng bộ; chỉ PAID hợp lệ mới cho lấy mẫu                                            |
| 07 → 11        | Huy      | Quân     | Toa FINAL, revision và snapshot thuốc; nhà thuốc kiểm tồn/giữ/phí riêng                                            |
| 05.06–05.07    | Huy      | Quân     | Component, patientId, API adapter và quyền đọc; không sao chép logic Clinical/Diagnostic vào Appointment           |
| Phiên và lease | Hưng     | Quân/Huy | `userId`, `actorType`, capabilities, transport, callback lease và lỗi hết phiên                                    |

Frontend gọi Gateway `/api/v1`; không truy cập trực tiếp DB/RabbitMQ/Redis và không tự đánh dấu nghiệp vụ thành công. Dữ liệu cá nhân thiếu phải hiển thị đúng tình trạng thiếu; không điền cố định tên, sinh hiệu hay thanh toán theo ảnh mẫu.

## 4. Cách sửa chung và xử lý conflict

1. Kiểm nhánh hiện tại và diff trước khi làm; cập nhật `develop` mới nhất trước tích hợp, giữ thay đổi chưa commit an toàn. Huy tiếp tục dùng nhánh `huy_task`, không tạo nhánh khác cho phần này.
2. Tự sửa trong feature mình phụ trách. Nếu cần thay file chung hoặc contract của người khác, thống nhất đầu mối và ghi rõ lý do, file, props/route/quyền bị ảnh hưởng trong PR.
3. Tách thay đổi tích hợp thành commit dễ review. Không format toàn bộ repo, đổi tên file hoặc refactor phần của người khác cùng một sửa nhỏ.
4. Không dùng reset/force push hoặc chọn toàn bộ ours/theirs để bỏ thay đổi bên kia. Đọc cả hai phía, giữ chức năng cần thiết và kiểm lại sau giải quyết conflict.
5. Không có conflict Git vẫn có thể lỗi logic: route sai, props lệch, session không cấp lease, CSS đè nhau. Cần thử điểm ghép ở bảng trên.
6. Chạy `npm run typecheck`, `npm test`, `npm run build` trong `apps/web`; thử route/menu đúng vai trò, tải/rỗng/lỗi, bản nháp, xác nhận, retry, phiên bản và đổi tài khoản.
7. Bàn giao kèm frame/route, component/props, API và action lease, trạng thái đã kiểm, lỗi hoặc phụ thuộc còn lại. Test mô phỏng không thay nghiệm thu API và dữ liệu thật.

Thay đổi tích hợp Huy hiện tại gồm `App.tsx` gắn route/menu/API và `runtime.ts` phân biệt lease hết hạn với JWT hết phiên. Khi gộp, Quân review router, Hưng review phiên/lease; không coi hai file này thuộc riêng Huy.

## 5. Dữ liệu và phạm vi kiểm thử

`tests/fixtures/huy-demo.json` là dữ liệu giả có đánh dấu, chỉ dùng test; không dùng làm tài khoản Identity thật và không fallback khi API lỗi. Các file env thật, JWT/private PEM, token, log có bí mật và file kiểm thử tạm nằm ngoài Git. File mẫu env chỉ chứa placeholder.

Phần Huy hiện tập trung nghiệm thu giao diện **web desktop** theo yêu cầu. Phạm vi các thành viên khác giữ theo thiết kế/phân công của nhóm. Các màn Billing/Notification hoặc phần ghép của Quân/Hưng trong bảng là trách nhiệm bàn giao, không phải xác nhận đã được Huy hoàn thành.

Xem thêm [README web](README.md), [Clinical](src/features/clinical/README.md), [Diagnostic](src/features/diagnostic/README.md) và [phân công chi tiết theo frame](../../docs/PHAN_CONG_FRONTEND_WEB_3_THANH_VIEN.md).
