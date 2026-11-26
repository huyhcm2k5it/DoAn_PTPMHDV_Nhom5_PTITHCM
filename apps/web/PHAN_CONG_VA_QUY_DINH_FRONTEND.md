# Phân công frontend HQH Care theo giao diện mới và backend

Cập nhật **25/11/2026**. Căn cứ: **138 PDF trong `HQH_Care_web.zip`**, source trên nhánh `huy_task`, chín service và hợp đồng trong `contracts/http/`. Đã đọc nội dung PDF, xem bố cục đại diện 05, 05.06, 12.01, 12.03 và đối chiếu code/API. Đây là **phân công để hoàn thiện**, chưa phải nghiệm thu giao diện hay dữ liệu online. Đã fetch/merge `origin/develop` tại `b355d60` vào `huy_task` trước phần hoàn thiện Huy.

Đường dẫn source tính từ `apps/web/`, trừ khi ghi khác. “Có code” nghĩa là đã thấy file/adapter/route, không đồng nghĩa chạy đúng toàn bộ. Không viết lại phần đã có nếu có thể sửa và tái sử dụng.

## 1. Chốt ai làm gì

| Thành viên | Backend sở hữu                  | Frontend chịu trách nhiệm cuối cùng                                                                                                                    | Thư mục/file chính                                                                                   |
| ---------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Quân**   | Patient, Appointment, Pharmacy  | Shell/menu/router; trang chủ; 02 hồ sơ; 03 đặt lịch; màn cha 05; 08 tiếp nhận; 11 cấp thuốc gồm 11.07; khung tổng quan 12 và ca trực 12.02             | `src/app/App.tsx`, CSS shell, `src/shared/ui/`; `src/features/patient/`, `appointment/`, `pharmacy/` |
| **Huy**    | Catalog, Clinical, Diagnostic   | 06 bàn khám gồm các trạng thái mới; 07 chỉ định/kê đơn; 10 LAB; nội dung/trang 05.06 kết quả và 05.07 toa đã ký; 12.01/12.06 giá; danh mục dùng chung  | `src/features/catalog/`, `clinical/`, `diagnostic/`                                                  |
| **Hưng**   | Identity, Billing, Notification | 01 tài khoản; thanh toán 04; 09 thu ngân/hoàn; 12.03 quyền; 12.04 audit; phần Billing của 12.05 báo cáo; thông báo đã đọc; JWT/lease/session/transport | `src/features/identity/`, `billing/`, `notification/`; `src/app/runtime.ts`; `src/shared/api/`       |

**Một việc có một người chốt đầu ra.** Quân ghép route/menu và khung; owner nghiệp vụ giữ API/types/validation/trạng thái. Các thành viên không tạo web, preview, stack hay cơ chế đăng nhập riêng.

### Những điểm được chốt lại theo ZIP mới

- **05.06 và 05.07 là hai trang riêng dùng chung thanh “Lịch hẹn của tôi / Kết quả xét nghiệm / Đơn thuốc”.** Giữ hai route Huy hiện có là phù hợp. Quân nối tab/nút và ngữ cảnh hồ sơ/lịch; Huy làm nội dung và đường quay lại. Không bắt buộc nhét toàn bộ vào trang chi tiết lịch.
- **Nhóm 12 không giao hết cho Quân:** Quân dựng khung và ca; Huy làm giá; Hưng làm quyền, audit, số tiền thu/hoàn. Mỗi chỉ số phải có API nguồn.
- **Thông báo đã đọc là chức năng dùng chung**, không còn ghi “chờ thiết kế” cho trạng thái này: ZIP đã có biến thể. Hưng cung cấp component/API, Quân gắn chuông vào shell. ZIP chưa có trang hộp thư độc lập hoàn chỉnh; nếu cần thì tái dùng cùng mẫu UI, không coi đó là một PDF đã có.
- Biến thể `OTHER`, “đã lưu version 2”, `04.02F/04.03F`, `11.07`, `06.10` là trạng thái/đối tượng trong cùng luồng, không phải ứng dụng hay bộ dữ liệu riêng.
- PDF còn tên UMC và dữ liệu mẫu: sản phẩm giữ **HQH Care** của repo; không chép tên người, giá, ngày, số đếm minh họa thành dữ liệu thật.

## 2. Đã làm được gì và phần còn lại

| Nhóm        | Source hiện có để giữ lại                                                                                                             | Phần còn thiếu/cần đối chiếu                                                                                                                                                                      | Người chốt                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 01          | `LoginPage`, `RegisterPage`, `VerifyOtpPage`, `ForgotPasswordPage`, `ResetPasswordPage`, runtime login/session/refresh/logout         | Đủ trạng thái OTP/reset/quyền theo PDF; đổi mật khẩu khi đang đăng nhập IA-009 nếu đưa vào UI; nghiệm thu hết phiên                                                                               | Hưng                                          |
| 02          | `ProfileList`, `ProfileDetail`, `ProfileForm`, Patient adapter                                                                        | SELF/OTHER, tạo/sửa version 2, loading/error/409 và số hồ sơ thật                                                                                                                                 | Quân                                          |
| 03          | `AvailableSlots`, `BookingCalendar`, Catalog/Appointment adapters                                                                     | Giữ người khám xuyên bước; khoa/dịch vụ → bác sĩ/slot → người khám → hold → 04                                                                                                                    | Quân; Huy cung cấp Catalog                    |
| 04          | `BookingReview.tsx` đang ở Appointment; có tạo appointment và chọn phương thức                                                        | Đã có FE Billing api.ts/types.ts; còn fallback tên/giá/đồng hồ mẫu; cần trạng thái charge/payment thật. Tạo appointment không phải thanh toán thành công                                          | Hưng phần Billing; Quân phần hold/Appointment |
| 05          | `MyAppointments`, `AppointmentDetail`, route đổi/hủy                                                                                  | Develop mới đã có link/tab và AppointmentRecords theo lịch; tiếp tục nghiệm thu trạng thái hoàn/thu của Hưng                                                                                      | Quân                                          |
| 05.06–05.07 | `PublishedLabResults`, `MedicalHistory`, `SignedPrescription`, `PatientRecordsRoute`, route riêng và adapter                          | Trang riêng đọc theo `patientId`; AppointmentRecords của Quân đã ghép theo lịch trên develop mới. Chỉnh bố cục, thông tin công bố, tên người ký và ngữ cảnh đúng nguồn; ghép đường đi/về với Quân | Huy nội dung; Quân điều hướng                 |
| 06–07       | `ClinicalRoute`, `ClinicalFeature`, `DraftEditor`, `TreatmentPanel`, guard rời trang, Clinical adapter                                | Đối chiếu 06.05/06.06/06.07/06.10 và 07.01–07.09; chỉ số chưa có nguồn không được điền giả                                                                                                        | Huy                                           |
| 08          | `ReceptionQueue`, Appointment adapter                                                                                                 | FIRST/RETURN, vé/version/bác sĩ bàn giao Huy; nhãn CCCD/QR phải đối chiếu API thực tế                                                                                                             | Quân                                          |
| 09          | `CashierQueueRoute` trong `App.tsx` hiện là khung tĩnh “0 khoản thu”; Billing đã có api.ts/types.ts; chưa có page thu ngân hoàn chỉnh | Queue, chi tiết, thu/poll, biên nhận và hoàn tiền cần triển khai thật                                                                                                                             | Hưng; Quân ghép                               |
| 10          | `DiagnosticFeature`, `ResultEditor`, `CancelLabDialog`, adapter                                                                       | Đủ trạng thái mẫu/duyệt/làm lại/công bố, điều kiện thu phí và không tự duyệt                                                                                                                      | Huy                                           |
| 11          | `PrescriptionQueue`, `PrescriptionDetail`, `StockPage`, `PatientMedicationStatus`, adapter                                            | Đối chiếu giữ toàn toa, hết hạn, settlement, 11.07 queue sau cấp phát; route chi tiết phải chọn đúng toa                                                                                          | Quân                                          |
| 12          | `AdminSummary` tổng hợp Appointment; `ScheduleAdmin`; `CatalogPage`/`PriceForm` tạo giá                                               | Khung tổng quan mới; lịch sử giá có CA-007 và trang Huy `/staff/prices`; chưa có page quyền/audit/Billing report, không có đủ mọi KPI trong PDF                                                   | Chia theo bảng mục 1                          |
| Thông báo   | Backend GET/PATCH có; `features/notification/` chỉ README                                                                             | Chưa có FE adapter/component/đánh dấu đã đọc/đích mở; cần làm một lần trong shell                                                                                                                 | Hưng; Quân ghép                               |

## 3. Nhiệm vụ cụ thể của Quân

| Mã       | Màn cần bao phủ                                                      | Công việc và đầu ra                                                                                                                                                                                                        | API/nguồn backend                                                                    |
| -------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Q-01** | Shell các actor, header/menu/tab/khung quản trị                      | Giữ một router `App.tsx`; chuẩn hóa layout bệnh nhân/bác sĩ/STAFF theo ZIP. Ghép component các owner, active menu/breadcrumb nhất quán; gắn chuông của Hưng; không tự đổi vai trò                                          | IA-010 qua runtime; shared UI                                                        |
| **Q-02** | 02 chính; 02.01/02.02 OTHER; 02.03 thêm hồ sơ; bốn bản lưu version 2 | Tái dùng page hiện có. Chọn đúng SELF/OTHER, tạo/sửa theo quyền, expectedVersion thật; 409 giữ nội dung để đối chiếu. Số hồ sơ từ API. Không thêm nút xóa vì không có API xóa                                              | PT-001/003/004/005; `features/patient/`                                              |
| **Q-03** | 03.01 bước 1; 03 chính là bước bác sĩ/giờ; 03.03 người khám          | Khoa/dịch vụ từ Huy → bác sĩ/slot trống → hồ sơ owner → hold → 04. Đổi bác sĩ/ngày/hồ sơ phải kiểm lại hold; giá Catalog chỉ tham khảo. Không cố định tháng 11/2026                                                        | CA-001/002/003; AP-004/008/009; PT-001                                               |
| **Q-04** | 05 chính, 05.01–05.05, 05.08 và lịch OTHER đã xác nhận               | Danh sách/chi tiết/lọc, đổi/hủy có xác nhận; dùng trạng thái API, cập nhật sau ghi. Hủy chưa thu không tạo hoàn; hoàn REQUESTED/FAILED/SUCCEEDED do Hưng bàn giao. SELF/OTHER cùng quy tắc owner                           | AP-011/012/013/014; BI-002/003/009 qua component Hưng                                |
| **Q-05** | 05 ↔ 05.06 ↔ 05.07                                                   | Thêm thanh ba mục và nút từ danh sách/chi tiết; giữ patientId, lịch/visit khi có quan hệ được xác minh, vị trí quay lại và bộ lọc. Không viết lại hai component Huy. Chi tiết mapping tại mục 7                            | Các route Huy hiện có; API đọc theo hồ sơ; AppointmentRecords do Quân ghép theo lịch |
| **Q-06** | 08, 08.01–08.04; bàn giao 06.01–06.04                                | Tra cứu hợp quyền, kiểm lịch/phí, check-in mới cấp số; RETURN giữ visit/số cũ và không thu khám lại. Bàn giao ticketId/doctorId/expectedTicketVersion cho Huy. Nút gọi tiếp/no-show theo quyền Appointment                 | PT-002/004; AP-015/016/017/018                                                       |
| **Q-07** | 11, 11.01–11.07; kho và trang thuốc bệnh nhân đang có                | Giữ toàn toa hoặc báo thiếu; countdown theo expiresAt; UNKNOWN/settlement locked không tự nhả hay giữ lại. Backend xác nhận mới dispense; sau phát cập nhật queue, xem lại chỉ đọc, không cấp hai lần                      | PH-001–008; `features/pharmacy/`                                                     |
| **Q-08** | 12 khung, 12.02 ca trực                                              | Giữ `AdminSummary`/`ScheduleAdmin`; ghép khối Billing của Hưng và giá của Huy. Chọn doctor/service từ danh mục, quản lý ca tương lai, room/capacity/version; tải ca lỗi không coi là rỗng. Ghi nguồn/thời điểm cho mỗi KPI | AP-019; GET `/api/v1/schedules` trong router; AP-005/006; CA-002/003                 |

**Bàn giao BookingReview:** Quân giữ tạo/release hold và AP-010 tạo appointment. Hưng cung cấp phần Billing để ghép vào cùng route review. Không làm hai page thanh toán cạnh tranh; hai người không sửa cùng vùng file khi chưa bàn giao rõ.

## 4. Nhiệm vụ cụ thể của Huy

| Mã       | Màn cần bao phủ                                                                            | Công việc và đầu ra                                                                                                                                                                                                                                                     | API/nguồn backend                                                     |
| -------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **H-01** | 06 chính, 06.01 FIRST đang nhận, 06.02 đúng lượt, 06.03 RETURN đang nhận, 06.04 mở lượt cũ | Giữ `ClinicalRoute`/`ClinicalFeature`; nhận ticket từ Quân hoặc worklist, chỉ mở điều trị sau ACCEPTED có visitId. RETURN không tạo visit mới; SIGNED không claim lại                                                                                                   | CL-001/002/003, projection Appointment                                |
| **H-02** | 06.05 lịch sử; 06.06 LAB; 06.07 nháp version 2; 06.10 SIGNED                               | Tab lịch sử chỉ SIGNED, tab LAB chỉ PUBLISHED. Lưu bốn trường symptoms/findings/assessment/diagnosis theo version thật; 409/lỗi mạng giữ nội dung, rời trang có cảnh báo. SIGNED khóa sửa. ZIP không có mã 06.08/06.09, không tự đặt thêm màn để lấp số                 | CL-004/011; DI-013; dữ liệu nhân khẩu phải có nguồn hợp quyền         |
| **H-03** | 07 chính và 07.01–07.09                                                                    | Tái dùng `TreatmentPanel`: testId/revision, snapshot thuốc; gửi chỉ định một lần rồi theo dõi; lưu/sửa/xóa nháp; tách ký kết luận CL-010 và ký toa CL-009. Điều kiện ký theo API, không gộp thành một cờ đã ký; toa nháp chưa chuyển nhà thuốc                          | CA-005/006; CL-003/005/006/007/008/009/010; DI-012 khi được hủy       |
| **H-04** | 10 chính và 10.01–10.07                                                                    | Queue/chi tiết → mẫu → nháp → gửi duyệt → độc lập duyệt hoặc trả làm lại → công bố. Chưa thu hợp lệ không lấy mẫu. Người có cả LAB_TECH và LAB_REVIEW vẫn bị chặn tự duyệt nếu đã góp dữ liệu. Kết quả PUBLISHED chỉ đọc                                                | DI-002–012; `DiagnosticFeature`, `ResultEditor`, `CancelLabDialog`    |
| **H-05** | 05.06 và bản thông báo đã đọc                                                              | Giữ `PublishedLabResults`, route `/patient/lab-results`; bố cục bảng + thông tin công bố theo ZIP; chỉ PUBLISHED; loading/rỗng/lỗi/phân trang, bất thường có chữ/ký hiệu. Không hiển thị dữ liệu hồ sơ cũ khi đổi hồ sơ. Hợp đồng link/mapping ở mục 7                  | DI-013; lease DI-013 từ runtime Hưng                                  |
| **H-06** | 05.07 và bản thông báo đã đọc                                                              | Giữ `MedicalHistory`/`SignedPrescription`/`PatientRecordsRoute`. Tab “Đơn thuốc” ưu tiên toa FINAL, tên/liều/SL/lời dặn, chỉ đọc; bệnh án SIGNED ghi rõ là bệnh án. FINAL không có nghĩa đã cấp thuốc. Link quay lại lịch và trạng thái Pharmacy dùng cùng context Quân | CL-011; lease CL-011; không thêm API đọc toa trùng khi response đã đủ |
| **H-07** | 12.01 phiên bản giá; 12.06 tạo version 2; danh mục phục vụ 03/07/11/12                     | Tái dùng `CatalogPage`, `PriceForm`, adapter. Chỉ tạo giá cho item có thật; không sửa đè lịch sử; khoảng hiệu lực tương lai/không chồng theo backend. Bảng đầy đủ v1/v2 cần giải quyết B-01; không lưu lịch sử giả trong FE                                             | CA-001–006; CA-004 có lease/idempotency                               |

Huy bàn giao **component + types/props + quyền + API + trạng thái**, Quân ghép router/menu. Không dùng ID bác sĩ Catalog thay userId Identity. Tên người nhập/duyệt/mã lịch trong PDF chỉ hiển thị khi response hoặc lookup hợp quyền cung cấp.

## 5. Nhiệm vụ cụ thể của Hưng

| Mã       | Màn cần bao phủ                                     | Công việc và đầu ra                                                                                                                                                                                                                                                                                                                              | API/nguồn backend                                                          |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **U-01** | 01 chính và 01.01–01.13                             | Giữ các page hiện có; phone/email, đăng ký → OTP → login, resend/cooldown, mã sai/hết hạn, quên/reset. Phản hồi quên mật khẩu không lộ tài khoản. Frame 01.13 dùng phiên thật, không có menu tự cấp quyền. IA-009 nếu cần đổi mật khẩu đã đăng nhập                                                                                              | IA-001–010; `features/identity/`                                           |
| **U-02** | 04 chính, 04.01–04.09; các bản OTHER; 04.02F/04.03F | Bổ sung Billing adapter/types/component trong `features/billing/` (đây là việc cần làm, chưa phải file đã có). Nhận hold/appointment từ Quân, đợi chargeSync/chargeId, lấy phí thật. POST payment 202 chỉ đang xử lý; poll charge và lịch. PENDING/UNKNOWN/IN_DOUBT khóa tạo giao dịch khác. Chỉ báo lịch xác nhận khi Appointment trả CONFIRMED | BI-002/003/004; AP-010/011 của Quân; không gọi BI-001 nội bộ để tạo charge |
| **U-03** | 09 chính, 09.01–09.04; 09.08–09.11                  | Queue thật thay khung “0 khoản thu”. EXAM/LAB/MEDICINE tách đúng nguồn; chỉ thu khoản hợp lệ, amount từ server, transactionId chống trùng; poll tới trạng thái cuối. Chỉ xem/in receipt khi có ID server. Tiền đưa/thừa không đổi số phải thu                                                                                                    | BI-013/002/005/006; Quân ghép `/staff/cashier`                             |
| **U-04** | 09.05–09.07; nội dung hoàn trong 05.03–05.05/05.08  | Queue/chi tiết hoàn, REQUESTED/SUCCEEDED/FAILED; retry/đối soát. Đúng source/cancellation evidence, tổng hoàn không quá tiền thu; hủy chưa thu không hoàn; không tạo hoàn hai lần. Bàn giao khối trạng thái cho Quân/Huy                                                                                                                         | BI-007/008/009/014; owner hủy AP/DI/PH gửi event                           |
| **U-05** | 12.03 quyền nhân viên                               | Thêm page và adapter quản trị Identity: danh sách STAFF/capability/scope, cập nhật expectedVersion, chặn ADMIN cuối cùng/409, refresh quyền. Không cho nhân viên tự đổi actor/role                                                                                                                                                               | IA-011/012; STAFF[ADMIN], lease theo BE                                    |
| **U-06** | 12.04 audit                                         | Thêm page audit: filter/phân trang theo API; ghi rõ phạm vi Identity. Ví dụ audit giá/LAB trong PDF chưa chứng minh IA-013 có thể đọc toàn hệ thống                                                                                                                                                                                              | IA-013; chốt B-04 nếu cần tổng hợp xuyên service                           |
| **U-07** | 12.05 và thẻ thu/hoàn của 12                        | Component Billing report lấy receivedVnd/refundedVnd/asOf; kỳ lọc khớp Quân, giữ asOf từng nguồn; không tự tạo KPI công suất/chờ. Tiền VND số nguyên                                                                                                                                                                                             | BI-010; Quân ghép AP-019; quyền ADMIN                                      |
| **U-08** | Chuông và 21 bản “Thông báo đã đọc”                 | Một adapter + popover/list + trạng thái đọc chung trong Notification; GET list/unreadOnly, PATCH đúng id rồi cập nhật; route đích theo kind/payload và quyền. Không một cờ đọc riêng theo page, không nhân bản page                                                                                                                              | NO-001/002; subject ref cần resolve qua API owner                          |
| **U-09** | Runtime chung                                       | Token/refresh/lease, phân biệt lease hết hạn với JWT hết phiên; 401/403/503; xóa dữ liệu người trước khi đổi tài khoản/logout. Giữ một token store/runtime/transport, FE chỉ gọi Gateway                                                                                                                                                         | IA-005/006/010; `runtime.ts`, `shared/api/`                                |

Người bệnh chọn **thanh toán tại quầy** trong 04 chỉ tạo/tiếp tục lịch chờ thu; không được gọi BI-005 vốn dành CASHIER. Các frame FAILED trong ZIP dùng để nghiệm thu lỗi, không cho FE tự gán kết quả thanh toán thật là FAILED/SUCCEEDED.

## 6. Quy định file và route

### 6.1 File chung: ai sửa, ai review

| Vùng                                                    | Người chốt     | Quy định tránh xung đột                                                                                        |
| ------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `features/patient/**`, `appointment/**`, `pharmacy/**`  | Quân           | Nhận block Huy/Hưng, không sao chép logic API vào feature khác                                                 |
| `features/catalog/**`, `clinical/**`, `diagnostic/**`   | Huy            | Giữ component bệnh án/LAB/toa và validation tại owner                                                          |
| `features/identity/**`, `billing/**`, `notification/**` | Hưng           | Quân nhận component/props để ghép shell                                                                        |
| `app/App.tsx`, CSS shell, router/menu, `shared/ui/**`   | Quân           | Owner gửi import/props/capability/route; không ba người cùng sửa một vùng router                               |
| `app/runtime.ts`, `shared/api/**`                       | Hưng           | Huy/Quân review cách dùng Bearer/lease/retry/lỗi; README cũ ghi Quân ở shared API được thay theo phân công này |
| `package.json`, lockfile, Vite và tokens chung          | Quân điều phối | Thêm dependency khi cần; một lockfile, một bộ style chung                                                      |
| `tests/**`                                              | Owner feature  | Giữ hồi quy quan trọng, không preview/stack/env riêng; test ghép có owner gửi/nhận                             |
| API contract/DTO/DB/schema                              | Owner backend  | Đổi endpoint/response phải cập nhật contract/client và cho consumer review                                     |

Giữ các thay đổi local hiện có; cập nhật `develop` an toàn trước lúc tích hợp sau khi kiểm diff. Không reset/chép đè phần người khác; không coi tài liệu này là đã cập nhật nhánh mới nhất. Huy tiếp tục dùng `huy_task`.

### 6.2 Route đang có và đề xuất

| Nhóm            | Route                                                                                                                                                                                | Trạng thái/kế hoạch                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 01              | `/login`, `/register`, `/register/verify`, `/forgot-password`, `/forgot-password/reset`                                                                                              | Đã có; lỗi OTP là trạng thái cùng page                                                                                                          |
| 02              | `/patient/profiles`, `/patient/profiles/new`, `/patient/profiles/:patientId`, `/patient/profiles/:patientId/edit`                                                                    | Đã có; OTHER qua dữ liệu, không route khác                                                                                                      |
| 03–04           | `/patient/appointments/new`, `/patient/appointments/review`                                                                                                                          | Đã có; giữ route review, ghép Billing vào luồng hiện tại                                                                                        |
| 05              | `/patient/appointments`, `/patient/appointments/:appointmentId`, thêm hậu tố `/reschedule`, `/cancel`                                                                                | Đã có; Quân nối tab/nút Huy                                                                                                                     |
| 05.06/05.07     | `/patient/lab-results`, `/patient/medical-records`                                                                                                                                   | Đã có; bổ sung giữ hồ sơ/ngữ cảnh và bố cục theo ZIP                                                                                            |
| 06–07           | `/doctor/clinical`, `/doctor/treatment`                                                                                                                                              | Đã có; giữ visitId khi đi/về                                                                                                                    |
| 08/09/10        | `/staff/reception`, `/staff/cashier`, `/staff/diagnostic`                                                                                                                            | Đã có route; cashier hiện còn khung tĩnh                                                                                                        |
| 11              | `/staff/pharmacy`, `/staff/pharmacy/stock`, `/staff/pharmacy/stock/adjust`, `/staff/pharmacy/prescriptions`, `/staff/pharmacy/prescriptions/:prescriptionId`; `/patient/medications` | Đã có; kiểm route chi tiết chọn đúng toa và trạng thái phát thuốc                                                                               |
| 12 khung/ca/giá | `/staff/summary`, `/staff/schedules`, `/catalog`                                                                                                                                     | Đã có; khung tổng quan hiện mới số Appointment, Catalog có tạo giá                                                                              |
| 12 đề xuất mới  | `/staff/prices`, `/staff/permissions`, `/staff/audit`, `/staff/reports`                                                                                                              | `/staff/prices` đã được Huy ghép, dùng PriceVersionsPage/PriceForm/PriceHistory. Ba route quyền/audit/report còn chờ Hưng bàn giao và Quân ghép |

Không dùng mã PDF như `/05.06` làm route kỹ thuật. Trang bệnh nhân dùng label thân thiện “Kết quả xét nghiệm”, “Đơn thuốc”, “Lịch hẹn của tôi”.

## 7. Hợp đồng ghép để luồng đi/về không đứt

| Điểm giao             | Người giao → nhận | Dữ liệu và quy tắc                                                                               | Tiêu chí đúng                                                                                                      |
| --------------------- | ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 03 → 04               | Quân → Hưng       | patientId, holdId, expiresAt từ BE; doctor/service/slot và nhãn có nguồn                         | Hết hold quay lại chọn slot; đổi người khám không giữ charge của người cũ                                          |
| 04 → 05/09            | Hưng → Quân       | appointmentId/chargeId, phương thức, trạng thái hai service                                      | Chờ thu không CONFIRMED; khoản đã thu không thu lại                                                                |
| 05 ↔ 05.06/05.07      | Quân ↔ Huy        | patientId; appointmentId/visitId/orderId khi xác minh được quan hệ; link trở về nội bộ và bộ lọc | Đổi tab giữ hồ sơ; quay lại đúng lịch; refresh/direct URL vẫn đúng; không mặc định sang hồ sơ đầu tiên nếu đã chọn |
| 08 → 06               | Quân → Huy        | ticketId, doctorId, expectedTicketVersion; route hiện nhận cả tên ticketVersion                  | CL-002 ACCEPTED có visitId mới mở điều trị; FIRST/RETURN do BE quyết định                                          |
| 06 ↔ 07               | Huy               | visitId/version, nháp, trạng thái LAB/visit/toa                                                  | Không claim lại do điều hướng; không mất nháp; SIGNED khóa sửa                                                     |
| 07 → 09 → 10          | Huy → Hưng → Huy  | source/order/charge IDs, sourceRevision và trạng thái phí/fence qua BE                           | FE không publish RabbitMQ; chỉ lấy mẫu sau Diagnostic xác nhận đủ điều kiện                                        |
| 07 → 11               | Huy → Quân        | Toa FINAL/revision/snapshot qua event/projection BE                                              | Pharmacy giữ đủ, thanh toán và phát đúng attempt; FE không copy dữ liệu để giả đồng bộ                             |
| Hủy → hoàn            | Quân/Huy → Hưng   | cancellation evidence đúng sourceType/sourceId/revision/charge                                   | REQUESTED không đã hoàn; hủy chưa thu không tạo hoàn                                                               |
| Chuông → màn chi tiết | Hưng → owner page | id/kind/payload, tài khoản/hồ sơ, route được cho phép                                            | PATCH thành công mới đánh dấu đọc; không điều hướng URL tùy ý từ payload hoặc mở sai hồ sơ                         |
| 12 tổng quan          | Huy/Hưng → Quân   | Khối giá, Appointment summary, received/refunded/asOf của Billing                                | Một khung, mỗi số có nguồn/kỳ, không ghép số mẫu như dữ liệu thật                                                  |

**Giới hạn cần giải quyết cho 05.06/05.07:** DI-013/CL-011 hiện phân trang theo patientId; hai component riêng của Huy chưa có appointment filter; develop mới có AppointmentRecords của Quân duyệt đủ trang và ghép theo appointment. Nếu chỉ có patientId, ghi rõ xem **tất cả kết quả/toa của hồ sơ**, không khẳng định là của một lịch. Muốn lọc theo lịch, xác minh quan hệ visit/order/appointment trong DTO thực tế; thiếu thì owner Clinical/Diagnostic cùng Appointment bổ sung hợp đồng. Không lọc một trang 10 dòng rồi kết luận cả lịch không có kết quả. Đích quay lại chỉ nhận đường dẫn nội bộ đã kiểm tra.

## 8. Việc backend/hợp đồng phải chốt để FE không bịa dữ liệu

Các dòng dưới ghi rõ việc đã bổ sung và phần còn cần phối hợp; không suy ra đã chạy E2E online. CA-007 làm tổng hợp đồng thành 87 HTTP (84 qua Gateway + 3 recovery), tên file API86 lịch sử được giữ để không gãy đường dẫn.

| Mã       | Khoảng trống đã thấy                                                                                                                                   | Người chốt                               | Cách hoàn thiện                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B-01** | Đã bổ sung GET `/prices` CA-007, quyền ADMIN, filter/pagination và trang `/staff/prices`; 12.01/12.06 đọc phiên bản từ DB                              | Huy                                      | Đã có endpoint/DTO/client; chỉ query bảng price_versions hiện có, không thêm bảng hay seed. Cần nghiệm thu triển khai API qua Gateway, không dùng localStorage làm lịch sử |
| **B-02** | GET `/schedules` đã có router/FE, chưa có trong `appointment.openapi.json` hiện đọc                                                                    | Quân                                     | Cập nhật contract đúng endpoint hiện có; không tạo endpoint khác                                                                                                           |
| **B-03** | PDF 06 có dị ứng/huyết áp/nhịp tim/BMI; Clinical draft hiện bốn trường, chưa có nguồn bảo đảm cho các chỉ số này; PDF Patient còn ghi không lưu dị ứng | Huy, Quân xác nhận Patient               | Chỉ hiện dữ liệu có nguồn hợp quyền; thiếu ghi chưa cung cấp hoặc thống nhất mở rộng schema/API trước; không điền Aspirin/120-80 mẫu cho mọi người                         |
| **B-04** | PDF audit có ví dụ giá/LAB, IA-013 chỉ đọc audit Identity                                                                                              | Hưng, Huy phối hợp                       | Ghi rõ phạm vi; muốn audit xuyên service phải thống nhất nguồn/endpoint/quyền; không gọi là nhật ký toàn hệ thống khi mới một nguồn                                        |
| **B-05** | AP-019/BI-010 không có đủ KPI công suất/% hôm qua/thời gian chờ/chờ LAB trong PDF                                                                      | Quân điều phối; Hưng số tiền; Huy số LAB | Chốt định nghĩa/kỳ/múi giờ/asOf và API. Thiếu ghi chưa có nguồn, không hiển thị 0 như số thật hay dùng queue count thay số LAB                                             |
| **B-06** | Tên người nhập/duyệt/bác sĩ, mã lịch của 05.06/05.07 chưa được mọi DTO bảo đảm; LabResult type FE có enteredBy/orderId, chưa đủ mọi nhãn PDF           | Huy, Quân/Hưng mapping                   | Đối chiếu JSON thật, bổ sung snapshot/lookup hợp quyền nếu cần; không đoán Identity userId từ Catalog doctorId                                                             |
| **B-07** | Notification payload chủ yếu subject ref; chưa FE đích mở và chưa có trường tổng unread riêng                                                          | Hưng                                     | Resolve ref qua API hợp quyền; có thể dùng GET unreadOnly và total làm tổng chưa đọc; không lấy số dòng trang 1 làm tổng tất cả                                            |
| **B-08** | PDF 08 có CCCD/QR nhưng nguồn Patient và các PDF khác không bảo đảm trường này; QR ghi minh họa/PDF chưa hỗ trợ                                        | Quân                                     | Tra cứu theo contract thật; QR thật cần định dạng/xác minh đúng. Nút chưa hỗ trợ disable/ghi rõ; mã mẫu không là check-in hợp lệ                                           |

Adapter nội bộ phục hồi IA-014/BI-001/DI-001 không tự trở thành nút cho người dùng. FE gọi `/api/v1` qua Gateway và không tiếp xúc trực tiếp DB, RabbitMQ, Redis hoặc private key. Các sai khác request/response phải được owner backend xử lý cùng client/contract, không chỉ đổi chữ trên màn hình.

## 9. Thứ tự thực hiện và nghiệm thu

### Đợt 1: nền chung và chốt nguồn

- **Quân:** Q-01/Q-05, chốt props/route và vùng BookingReview bàn giao Hưng.
- **Huy:** rà H-01/H-02 đã có; chốt B-01/B-03/B-06 và mapping 05.
- **Hưng:** U-09, nền Billing/Notification adapter, B-04/B-07; U-05/U-06 có thể làm song song trong feature riêng.
- Đầu ra: API/route/props/phân quyền thống nhất, trường thiếu có owner; không đổi nhầm ID giữa service.

### Đợt 2: bệnh nhân và thu phí khám

- **Quân:** Q-02/Q-03/Q-04, giữ SELF/OTHER xuyên luồng, phối hợp ghép 04.
- **Hưng:** U-01/U-02/U-03, payment/poll/receipt thật.
- **Huy:** H-05/H-06 và danh mục; Quân nối tab/nút để không bỏ hai trang bệnh nhân.
- Đầu ra: login → hồ sơ → đặt lịch → 04 → chờ/thu → 05 → LAB/toa → quay lại; không fallback dữ liệu mẫu khi API lỗi.

### Đợt 3: khám, LAB, thuốc và hoàn phí

- **Quân:** Q-06/Q-07; **Huy:** H-01–04; **Hưng:** U-03/U-04/U-08.
- Đầu ra: FIRST → visit → chỉ định → thu LAB → mẫu → duyệt độc lập → PUBLISHED → RETURN cùng visit → ký kết luận → toa FINAL → giữ/thu/cấp thuốc. Có hủy/hoàn và retry đúng căn cứ.

### Đợt 4: quản trị và đủ biến thể ZIP

- **Quân:** Q-08/B-02/B-05; **Huy:** H-07/B-01; **Hưng:** U-05–08.
- Đầu ra: đủ 12.01/12.06 giá, 12.02 ca, 12.03 quyền, 12.04 audit, 12.05 báo cáo và toàn bộ biến thể đọc thông báo. Chưa đủ API phải ghi đang chờ, không đánh dấu xong.

### Điều kiện một nhiệm vụ được đánh dấu hoàn thành

- [ ] Đối chiếu tên PDF ở mục 10 với page/trạng thái; cùng component cho các biến thể, không route riêng cho từng frame.
- [ ] Bố cục web chính đúng thiết kế: header/menu/tab, hai cột, bảng, font/khoảng cách, active state. Không sao chép lỗi cắt/tràn chữ trong PDF.
- [ ] Có đường vào/về, refresh/deep link, selected profile SELF/OTHER và quyền đúng; owner nhận đã xác nhận phần ghép.
- [ ] Loading không lộ dữ liệu hồ sơ/lượt trước; rỗng khác lỗi; filter/page/selection nhất quán; đổi user/logout xóa dữ liệu cũ.
- [ ] Chống double click; retry cùng ý định giữ Idempotency-Key, nội dung khác tạo ý định mới; expectedVersion/409 không làm mất form/nháp.
- [ ] 202 là đang xử lý; polling có nhịp, hủy khi rời/đổi đối tượng; không nhiều timer/giao dịch trùng; 503 không coi thành công.
- [ ] Không tên/giá/kết quả/số đếm mẫu trong luồng thật; demo controls không ép trạng thái backend; thời hạn theo server, không countdown mẫu.
- [ ] Form có label/lỗi gần trường/focus bàn phím; trạng thái lỗi/bất thường không chỉ khác màu; giảm nhảy layout khi tải dữ liệu.
- [ ] Phạm vi hiện tại là **web desktop**; không mở rộng kiểm điện thoại khi chưa yêu cầu. Kiểm chiều rộng desktop nhóm chọn và không cuộn ngang ngoài vùng bảng cần thiết.
- [ ] Khi code được hoàn thiện mới chạy `npm run typecheck`, test hồi quy feature, `npm run build` và luồng tích hợp chung; lưu kết quả thật. Sau đồng bộ đã chạy kiểm tra code phần Huy; kết quả thực tế ghi trong bàn giao/commit, không suy ra đã E2E online.
- [ ] Bàn giao mã việc/PDF, file/route/props/API, ảnh đối chiếu, commit/PR và bước tái hiện. Có route hoặc compile xong chưa đủ nghiệm thu.

## 10. Kiểm kê ZIP: không bỏ sót frame

ZIP có **138 PDF một trang**, gồm **117 bản không có hậu tố “Thông báo đã đọc”** và **21 bản có hậu tố đó**. Mã trạng thái không nhất thiết liên tục; 03 chính là bước 2, không tự dựng thêm PDF 03.02. Nội dung mẫu ở một khoa/người khám trong Prototype không giới hạn dữ liệu thật của API.

| Nhóm | Số PDF gồm biến thể | Nhiệm vụ chốt                               |
| ---- | ------------------: | ------------------------------------------- |
| 01   |                  14 | U-01/U-09                                   |
| 02   |                   9 | Q-02; thông báo U-08                        |
| 03   |                   4 | Q-03; Huy Catalog; thông báo U-08           |
| 04   |                  32 | U-02; Quân hold/Appointment; thông báo U-08 |
| 05   |                  20 | Q-04/Q-05; H-05/H-06; U-04/U-08             |
| 06   |                   9 | H-01/H-02                                   |
| 07   |                  10 | H-03                                        |
| 08   |                   5 | Q-06                                        |
| 09   |                  12 | U-03/U-04                                   |
| 10   |                   8 | H-04                                        |
| 11   |                   8 | Q-07                                        |
| 12   |                   7 | Q-08; H-07; U-05/U-06/U-07                  |

Từng tên PDF và owner ở bảng dưới. **Tất cả dòng là checklist đối chiếu chưa nghiệm thu**, không phải danh sách màn đã hoàn thành. Các bản “Thông báo đã đọc” cần U-08 + Q-01 cùng owner nội dung; giữ layout/dữ liệu nghiệp vụ cũ khi đánh dấu đã đọc.

| #   | Tên PDF trong ZIP                                                      | Người chốt nội dung | Nhiệm vụ / phối hợp                                |
| --- | ---------------------------------------------------------------------- | ------------------- | -------------------------------------------------- |
| 1   | 01 · Đăng nhập.pdf                                                     | Hưng                | U-01/U-09                                          |
| 2   | 02 · Hồ sơ của tôi.pdf                                                 | Quân                | Q-02                                               |
| 3   | 03 · Đặt lịch khám.pdf                                                 | Quân                | Q-03; Huy Catalog                                  |
| 4   | 04 · Xác nhận & thanh toán.pdf                                         | Hưng                | U-02; Quân hold/Appointment                        |
| 5   | 05 · Lịch khám của tôi.pdf                                             | Quân                | Q-04/Q-05; Hưng Billing                            |
| 6   | 06 · Bàn khám bác sĩ.pdf                                               | Huy                 | H-01/H-02                                          |
| 7   | 07 · Chỉ định & kê đơn thuốc.pdf                                       | Huy                 | H-03                                               |
| 8   | 08 · Tiếp nhận bệnh nhân.pdf                                           | Quân                | Q-06; Huy nhận vé                                  |
| 9   | 09 · Thu ngân & viện phí.pdf                                           | Hưng                | U-03/U-04                                          |
| 10  | 10 · Không gian xét nghiệm.pdf                                         | Huy                 | H-04                                               |
| 11  | 11 · Cấp phát thuốc.pdf                                                | Quân                | Q-07                                               |
| 12  | 12 · Tổng quan bệnh viện.pdf                                           | Quân                | Q-08; khung tổng quan                              |
| 13  | 01.01 · Đăng ký tài khoản.pdf                                          | Hưng                | U-01/U-09                                          |
| 14  | 01.02 · Đăng ký · Email không hợp lệ.pdf                               | Hưng                | U-01/U-09                                          |
| 15  | 01.03 · Xác thực tài khoản.pdf                                         | Hưng                | U-01/U-09                                          |
| 16  | 01.04 · Xác thực · Mã sai.pdf                                          | Hưng                | U-01/U-09                                          |
| 17  | 01.05 · Xác thực · Mã hết hạn.pdf                                      | Hưng                | U-01/U-09                                          |
| 18  | 01.06 · Đăng ký thành công.pdf                                         | Hưng                | U-01/U-09                                          |
| 19  | 01.07 · Quên mật khẩu.pdf                                              | Hưng                | U-01/U-09                                          |
| 20  | 01.08 · Khôi phục · Phản hồi chung & OTP.pdf                           | Hưng                | U-01/U-09                                          |
| 21  | 01.09 · Khôi phục · Mã sai hoặc hết hạn.pdf                            | Hưng                | U-01/U-09                                          |
| 22  | 01.10 · Đặt mật khẩu mới.pdf                                           | Hưng                | U-01/U-09                                          |
| 23  | 01.11 · Đổi mật khẩu thành công.pdf                                    | Hưng                | U-01/U-09                                          |
| 24  | 01.12 · Đăng nhập · Bác sĩ/Nhân viên.pdf                               | Hưng                | U-01/U-09                                          |
| 25  | 01.13 · Phiên mẫu theo quyền được cấp.pdf                              | Hưng                | U-01/U-09                                          |
| 26  | 04.01 · Đang tạo khoản thu.pdf                                         | Hưng                | U-02; Quân hold/Appointment                        |
| 27  | 04.02 · Chờ thanh toán.pdf                                             | Hưng                | U-02; Quân hold/Appointment                        |
| 28  | 04.03 · Đang xử lý thanh toán.pdf                                      | Hưng                | U-02; Quân hold/Appointment                        |
| 29  | 04.04 · Thanh toán thất bại.pdf                                        | Hưng                | U-02; Quân hold/Appointment                        |
| 30  | 04.05 · Lịch đã xác nhận.pdf                                           | Hưng                | U-02; Quân hold/Appointment                        |
| 31  | 04.06 · Hết hạn giữ chỗ.pdf                                            | Hưng                | U-02; Quân hold/Appointment                        |
| 32  | 04.07 · Chọn thanh toán tại quầy.pdf                                   | Hưng                | U-02; Quân hold/Appointment                        |
| 33  | 04.08 · Đang tạo khoản thu tại quầy.pdf                                | Hưng                | U-02; Quân hold/Appointment                        |
| 34  | 04.09 · Lịch chờ thanh toán tại quầy.pdf                               | Hưng                | U-02; Quân hold/Appointment                        |
| 35  | 05.01 · Lịch chờ thanh toán.pdf                                        | Quân                | Q-04/Q-05; Hưng Billing                            |
| 36  | 05.02 · Xác nhận hủy lịch.pdf                                          | Quân                | Q-04/Q-05; Hưng Billing                            |
| 37  | 05.03 · Đã hủy · Hoàn tiền đã yêu cầu.pdf                              | Quân                | Q-04/Q-05; Hưng Billing                            |
| 38  | 05.04 · Đã hủy · Đã hoàn tiền.pdf                                      | Quân                | Q-04/Q-05; Hưng Billing                            |
| 39  | 05.05 · Đã hủy · Hoàn tiền thất bại.pdf                                | Quân                | Q-04/Q-05; Hưng Billing                            |
| 40  | 07.01 · Đang tạo chỉ định.pdf                                          | Huy                 | H-03                                               |
| 41  | 07.02 · Chờ kết quả · Khóa ký.pdf                                      | Huy                 | H-03                                               |
| 42  | 07.03 · Đã lưu toa nháp.pdf                                            | Huy                 | H-03                                               |
| 43  | 07.04 · Đủ điều kiện ký.pdf                                            | Huy                 | H-03                                               |
| 44  | 07.05 · Chỉ định hủy hợp lệ.pdf                                        | Huy                 | H-03                                               |
| 45  | 07.06 · Kết luận đã ký · Có thể ký toa.pdf                             | Huy                 | H-03                                               |
| 46  | 07.07 · Toa đã ký · Chỉ đọc.pdf                                        | Huy                 | H-03                                               |
| 47  | 08.01 · Đang tiếp nhận lượt khám.pdf                                   | Quân                | Q-06; Huy nhận vé                                  |
| 48  | 08.02 · Đã check-in · Cấp số lần đầu.pdf                               | Quân                | Q-06; Huy nhận vé                                  |
| 49  | 08.03 · Quay lại sau xét nghiệm.pdf                                    | Quân                | Q-06; Huy nhận vé                                  |
| 50  | 08.04 · Tiếp nhận lại đúng lượt cũ.pdf                                 | Quân                | Q-06; Huy nhận vé                                  |
| 51  | 06.01 · Đang tiếp nhận lượt khám.pdf                                   | Huy                 | H-01/H-02                                          |
| 52  | 06.02 · Khám lần đầu · Đúng lượt đã tiếp nhận.pdf                      | Huy                 | H-01/H-02                                          |
| 53  | 06.03 · Đang tiếp nhận lượt quay lại.pdf                               | Huy                 | H-01/H-02                                          |
| 54  | 06.04 · Quay lại sau xét nghiệm · Mở lượt cũ.pdf                       | Huy                 | H-01/H-02                                          |
| 55  | 09.01 · Đang xử lý thu tại quầy.pdf                                    | Hưng                | U-03/U-04                                          |
| 56  | 09.02 · Thu tại quầy thất bại.pdf                                      | Hưng                | U-03/U-04                                          |
| 57  | 09.03 · Thu tại quầy thành công.pdf                                    | Hưng                | U-03/U-04                                          |
| 58  | 09.04 · Biên nhận viện phí.pdf                                         | Hưng                | U-03/U-04                                          |
| 59  | 09.05 · Hoàn tiền · Đã yêu cầu.pdf                                     | Hưng                | U-03/U-04                                          |
| 60  | 09.06 · Hoàn tiền · Đã hoàn.pdf                                        | Hưng                | U-03/U-04                                          |
| 61  | 09.07 · Hoàn tiền · Hoàn thất bại.pdf                                  | Hưng                | U-03/U-04                                          |
| 62  | 09.08 · Thu phí khám chờ thanh toán.pdf                                | Hưng                | U-03/U-04                                          |
| 63  | 09.09 · Đang thu phí khám.pdf                                          | Hưng                | U-03/U-04                                          |
| 64  | 09.10 · Phí khám đã thu · Lịch xác nhận.pdf                            | Hưng                | U-03/U-04                                          |
| 65  | 09.11 · Biên nhận phí khám.pdf                                         | Hưng                | U-03/U-04                                          |
| 66  | 10.01 · Có thể lấy mẫu.pdf                                             | Huy                 | H-04                                               |
| 67  | 10.02 · Kết quả nháp.pdf                                               | Huy                 | H-04                                               |
| 68  | 10.03 · Chờ duyệt · Người nhập.pdf                                     | Huy                 | H-04                                               |
| 69  | 10.04 · Duyệt · Người duyệt độc lập.pdf                                | Huy                 | H-04                                               |
| 70  | 10.05 · Chặn tự duyệt kết quả.pdf                                      | Huy                 | H-04                                               |
| 71  | 10.06 · Cần làm lại.pdf                                                | Huy                 | H-04                                               |
| 72  | 10.07 · Đã công bố.pdf                                                 | Huy                 | H-04                                               |
| 73  | 11.01 · Thiếu tồn · Không giữ một phần.pdf                             | Quân                | Q-07                                               |
| 74  | 11.02 · Đã giữ đủ toa · 15 phút.pdf                                    | Quân                | Q-07                                               |
| 75  | 11.03 · Chờ đồng bộ thanh toán.pdf                                     | Quân                | Q-07                                               |
| 76  | 11.04 · Có thể cấp phát.pdf                                            | Quân                | Q-07                                               |
| 77  | 11.05 · Đã cấp phát.pdf                                                | Quân                | Q-07                                               |
| 78  | 11.06 · Hết hạn giữ thuốc.pdf                                          | Quân                | Q-07                                               |
| 79  | 05.06 · Kết quả xét nghiệm đã công bố.pdf                              | Huy                 | H-05; Quân Q-05 điều hướng                         |
| 80  | 05.07 · Toa thuốc đã ký · Chỉ đọc.pdf                                  | Huy                 | H-06; Quân Q-05 điều hướng                         |
| 81  | 05.08 · Đã hủy · Chưa thu phí.pdf                                      | Quân                | Q-04/Q-05; Hưng Billing                            |
| 82  | 07.08 · Toa nháp đã lưu · Vẫn đủ điều kiện ký.pdf                      | Huy                 | H-03                                               |
| 83  | 07.09 · Toa nháp đã lưu · Chưa gửi chỉ định.pdf                        | Huy                 | H-03                                               |
| 84  | 02 · Hồ sơ của tôi · Thông báo đã đọc.pdf                              | Quân                | Q-02; Hưng U-08 + Quân Q-01                        |
| 85  | 03 · Đặt lịch khám · Thông báo đã đọc.pdf                              | Quân                | Q-03; Huy Catalog; Hưng U-08 + Quân Q-01           |
| 86  | 04 · Xác nhận & thanh toán · Thông báo đã đọc.pdf                      | Hưng                | U-02; Quân hold/Appointment; Hưng U-08 + Quân Q-01 |
| 87  | 05 · Lịch khám của tôi · Thông báo đã đọc.pdf                          | Quân                | Q-04/Q-05; Hưng Billing; Hưng U-08 + Quân Q-01     |
| 88  | 04.01 · Đang tạo khoản thu · Thông báo đã đọc.pdf                      | Hưng                | U-02; Quân hold/Appointment; Hưng U-08 + Quân Q-01 |
| 89  | 04.02 · Chờ thanh toán · Thông báo đã đọc.pdf                          | Hưng                | U-02; Quân hold/Appointment; Hưng U-08 + Quân Q-01 |
| 90  | 04.03 · Đang xử lý thanh toán · Thông báo đã đọc.pdf                   | Hưng                | U-02; Quân hold/Appointment; Hưng U-08 + Quân Q-01 |
| 91  | 04.04 · Thanh toán thất bại · Thông báo đã đọc.pdf                     | Hưng                | U-02; Quân hold/Appointment; Hưng U-08 + Quân Q-01 |
| 92  | 04.05 · Lịch đã xác nhận · Thông báo đã đọc.pdf                        | Hưng                | U-02; Quân hold/Appointment; Hưng U-08 + Quân Q-01 |
| 93  | 04.06 · Hết hạn giữ chỗ · Thông báo đã đọc.pdf                         | Hưng                | U-02; Quân hold/Appointment; Hưng U-08 + Quân Q-01 |
| 94  | 04.07 · Chọn thanh toán tại quầy · Thông báo đã đọc.pdf                | Hưng                | U-02; Quân hold/Appointment; Hưng U-08 + Quân Q-01 |
| 95  | 04.08 · Đang tạo khoản thu tại quầy · Thông báo đã đọc.pdf             | Hưng                | U-02; Quân hold/Appointment; Hưng U-08 + Quân Q-01 |
| 96  | 04.09 · Lịch chờ thanh toán tại quầy · Thông báo đã đọc.pdf            | Hưng                | U-02; Quân hold/Appointment; Hưng U-08 + Quân Q-01 |
| 97  | 05.01 · Lịch chờ thanh toán · Thông báo đã đọc.pdf                     | Quân                | Q-04/Q-05; Hưng Billing; Hưng U-08 + Quân Q-01     |
| 98  | 05.02 · Xác nhận hủy lịch · Thông báo đã đọc.pdf                       | Quân                | Q-04/Q-05; Hưng Billing; Hưng U-08 + Quân Q-01     |
| 99  | 05.03 · Đã hủy · Hoàn tiền đã yêu cầu · Thông báo đã đọc.pdf           | Quân                | Q-04/Q-05; Hưng Billing; Hưng U-08 + Quân Q-01     |
| 100 | 05.04 · Đã hủy · Đã hoàn tiền · Thông báo đã đọc.pdf                   | Quân                | Q-04/Q-05; Hưng Billing; Hưng U-08 + Quân Q-01     |
| 101 | 05.05 · Đã hủy · Hoàn tiền thất bại · Thông báo đã đọc.pdf             | Quân                | Q-04/Q-05; Hưng Billing; Hưng U-08 + Quân Q-01     |
| 102 | 05.06 · Kết quả xét nghiệm đã công bố · Thông báo đã đọc.pdf           | Huy                 | H-05; Quân Q-05 điều hướng; Hưng U-08 + Quân Q-01  |
| 103 | 05.07 · Toa thuốc đã ký · Chỉ đọc · Thông báo đã đọc.pdf               | Huy                 | H-06; Quân Q-05 điều hướng; Hưng U-08 + Quân Q-01  |
| 104 | 05.08 · Đã hủy · Chưa thu phí · Thông báo đã đọc.pdf                   | Quân                | Q-04/Q-05; Hưng Billing; Hưng U-08 + Quân Q-01     |
| 105 | 11.07 · Hàng chờ · Toa đã cấp phát.pdf                                 | Quân                | Q-07                                               |
| 106 | 02.01 · Hồ sơ · OTHER · Trần Thị Lan.pdf                               | Quân                | Q-02                                               |
| 107 | 02.02 · Hồ sơ · OTHER · Nguyễn Khánh An.pdf                            | Quân                | Q-02                                               |
| 108 | 02.03 · Hồ sơ · Đã tạo · 4 hồ sơ · Mô phỏng.pdf                        | Quân                | Q-02                                               |
| 109 | 03.01 · Bước 1 · Chuyên khoa và dịch vụ.pdf                            | Quân                | Q-03; Huy Catalog                                  |
| 110 | 03.03 · Bước 3 · Thông tin người khám.pdf                              | Quân                | Q-03; Huy Catalog                                  |
| 111 | 04 · Xác nhận & thanh toán · OTHER · Trần Thị Lan.pdf                  | Hưng                | U-02; Quân hold/Appointment                        |
| 112 | 04.01 · Đang tạo khoản thu · OTHER · Trần Thị Lan.pdf                  | Hưng                | U-02; Quân hold/Appointment                        |
| 113 | 04.02 · Chờ thanh toán · OTHER · Trần Thị Lan.pdf                      | Hưng                | U-02; Quân hold/Appointment                        |
| 114 | 04.03 · Đang xử lý thanh toán · OTHER · Trần Thị Lan.pdf               | Hưng                | U-02; Quân hold/Appointment                        |
| 115 | 04.04 · Thanh toán thất bại · OTHER · Trần Thị Lan.pdf                 | Hưng                | U-02; Quân hold/Appointment                        |
| 116 | 04.05 · Lịch đã xác nhận · OTHER · Trần Thị Lan.pdf                    | Hưng                | U-02; Quân hold/Appointment                        |
| 117 | 04.06 · Hết hạn giữ chỗ · OTHER · Trần Thị Lan.pdf                     | Hưng                | U-02; Quân hold/Appointment                        |
| 118 | 04.07 · Chọn thanh toán tại quầy · OTHER · Trần Thị Lan.pdf            | Hưng                | U-02; Quân hold/Appointment                        |
| 119 | 04.08 · Đang tạo khoản thu tại quầy · OTHER · Trần Thị Lan.pdf         | Hưng                | U-02; Quân hold/Appointment                        |
| 120 | 04.09 · Lịch chờ thanh toán tại quầy · OTHER · Trần Thị Lan.pdf        | Hưng                | U-02; Quân hold/Appointment                        |
| 121 | 05.01 · Lịch chờ thanh toán · OTHER · Trần Thị Lan.pdf                 | Quân                | Q-04/Q-05; Hưng Billing                            |
| 122 | 04.03F · Thanh toán PENDING · Kịch bản thất bại.pdf                    | Hưng                | U-02; Quân hold/Appointment                        |
| 123 | 04.02F · Chờ thanh toán · Đã chọn FAILED trong demo.pdf                | Hưng                | U-02; Quân hold/Appointment                        |
| 124 | 06.05 · Bàn khám · Lịch sử khám đã ký.pdf                              | Huy                 | H-01/H-02                                          |
| 125 | 06.06 · Bàn khám · Kết quả đã công bố.pdf                              | Huy                 | H-01/H-02                                          |
| 126 | 06.07 · Nháp bốn trường · Đã lưu version 2.pdf                         | Huy                 | H-01/H-02                                          |
| 127 | 12.01 · Phiên bản giá.pdf                                              | Huy                 | H-07/B-01; Quân ghép menu                          |
| 128 | 12.02 · Phân công ca trực.pdf                                          | Quân                | Q-08/B-02                                          |
| 129 | 12.03 · Nhân viên và phân quyền.pdf                                    | Hưng                | U-05; Quân ghép menu                               |
| 130 | 12.04 · Nhật ký kiểm toán.pdf                                          | Hưng                | U-06/B-04; Quân ghép menu                          |
| 131 | 12.05 · Báo cáo theo asOf.pdf                                          | Hưng                | U-07; Quân ghép dữ liệu Appointment/B-05           |
| 132 | 12.06 · Giá · Đã tạo phiên bản 2.pdf                                   | Huy                 | H-07/B-01; Quân ghép menu                          |
| 133 | 02 · Hồ sơ của tôi · Đã lưu mẫu version 2.pdf                          | Quân                | Q-02                                               |
| 134 | 02.01 · Hồ sơ · OTHER · Trần Thị Lan · Đã lưu mẫu version 2.pdf        | Quân                | Q-02                                               |
| 135 | 02.02 · Hồ sơ · OTHER · Nguyễn Khánh An · Đã lưu mẫu version 2.pdf     | Quân                | Q-02                                               |
| 136 | 02.03 · Hồ sơ · Đã tạo · 4 hồ sơ · Mô phỏng · Đã lưu mẫu version 2.pdf | Quân                | Q-02                                               |
| 137 | 05 · Lịch đã xác nhận · OTHER · Trần Thị Lan.pdf                       | Quân                | Q-04/Q-05; Hưng Billing                            |
| 138 | 06.10 · Bệnh án SIGNED · Chỉ đọc.pdf                                   | Huy                 | H-01/H-02                                          |

## Cập nhật triển khai phần Huy sau đối chiếu

- H-01–H-04 giữ các guard/luồng sẵn có; DI-012 được sửa theo review để hủy chưa thu khi không có specimen/settlement đang xử lý. LabCancelled mang sourceRevision; Clinical chấp nhận extension này. Giữ các consumer cần có trước publisher mới.
- H-05/H-06: ba tab/đường quay lại giữ patientId; SELF/OTHER từ Patient API; profile không thuộc owner không tự đổi người; toa FINAL chỉ đọc, tách khỏi nội dung bệnh án; dữ liệu trang cũ không hiển thị khi đổi hồ sơ.
- H-07: trang giá `/staff/prices`, GET lịch sử CA-007 có ADMIN/token/projection, POST CA-004 lấy lease mới; không seed, không chỉnh schema DB.
- Đã gỡ Catalog -seed/seed.sql và Clinical -seed-demo/SeedDemo khỏi runtime. Fixture kiểm thử được giữ riêng, không có fallback sang seed khi API online lỗi.
- Các bước nghiệm thu trực tiếp DB/broker/Gateway online, metadata chưa được DTO cung cấp và KPI của owner khác vẫn phải được xác nhận riêng; không tự tạo dữ liệu để đạt trạng thái PDF.
