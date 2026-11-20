# Phân công frontend web HQH Care cho 3 thành viên

Ngày lập 20/11/2026. Phạm vi thực hiện là frontend React/TypeScript trong `apps/web` dựa trên trang **Web UI** của file HQH_Care.

Tên thành viên dùng theo phân công hiện có trong repo gồm **Quân, Huy và Hưng**. Đây là kế hoạch triển khai và hoàn thiện giao diện. Trạng thái hoàn thành cần được xác nhận bằng sản phẩm chạy được và kết quả kiểm tra.

## 1. Căn cứ phân công

- Đã đọc trực tiếp danh sách frame trên trang Web UI qua trình duyệt, gồm 12 nhóm đánh số 01–12, các frame trạng thái và nhóm Trang chủ bệnh nhân. Figma MCP đang báo giới hạn lượt gọi Starter. Bản phân công dựa trên tên frame và cấu trúc frontend hiện có, chưa phải bản nghiệm thu chi tiết từng thành phần giao diện. [Thiết kế HQH_Care](https://www.figma.com/design/SWT7Z7CgenxY5rRw45SjnL/HQH_Care?node-id=1-3364)
- Giữ đầu mối feature theo tài liệu bàn giao của nhóm để tận dụng code hiện có và hạn chế nhiều người sửa cùng một phần. [Phạm vi và đầu mối](ban-giao-hqh-care/PHAM_VI_VA_DAU_MOI.md)
- Các biến thể của một màn hình được triển khai trong cùng luồng với trạng thái dữ liệu tương ứng. Các mã như `07.01` là tên frame trên Figma, không mặc định là route riêng.

## 2. Bảng phân công tổng hợp

| Thành viên | Nhóm màn hình chịu trách nhiệm chính | Phần kỹ thuật phụ trách | Sản phẩm bàn giao |
| --- | --- | --- | --- |
| **Quân** | Trang chủ bệnh nhân, 02 Hồ sơ của tôi, 03 Đặt lịch khám, 05 Lịch khám của tôi, 08 Tiếp nhận bệnh nhân, 11 Cấp phát thuốc, 12 Tổng quan bệnh viện | App shell, sidebar/header, router, shared UI, Patient, Appointment, Pharmacy | Luồng bệnh nhân, tiếp nhận, cấp phát và tổng quan chạy trong ứng dụng chung |
| **Huy** | 06 Bàn khám bác sĩ, 07 Chỉ định & kê đơn thuốc, 10 Không gian xét nghiệm | Clinical, Diagnostic, dữ liệu danh mục phục vụ đặt lịch/chỉ định/kê đơn | Luồng bác sĩ và xét nghiệm, nội dung kết quả/toa để ghép vào màn hình bệnh nhân |
| **Hưng** | 01 Đăng nhập và các luồng tài khoản, 04 Xác nhận & thanh toán, 09 Thu ngân & viện phí | Identity, Billing, shared HTTP/session, kết nối thông báo khi có thiết kế | Luồng xác thực, thu tiền, biên nhận, hoàn tiền và adapter phiên dùng chung |

Khối lượng được cân đối theo độ phức tạp của luồng, số trạng thái và trách nhiệm tích hợp. Quân có nhiều màn danh sách và công việc shell. Huy phụ trách các thao tác khám, ký và duyệt kết quả. Hưng phụ trách nhiều trạng thái xác thực và thanh toán bất đồng bộ.

## 3. Quân — Bệnh nhân, tiếp nhận, nhà thuốc và shell

### Màn hình và trạng thái

| Nhóm Figma | Phạm vi cần hoàn thiện |
| --- | --- |
| Trang chủ bệnh nhân | Frame chính, biến thể Chưa có lịch, bản 768 và 360. Điều hướng sang đặt lịch, lịch khám và hồ sơ theo thiết kế |
| 02 · Hồ sơ của tôi | Danh sách, xem thông tin và các thao tác hồ sơ có trên thiết kế. Tận dụng `ProfileList`, `ProfileDetail`, `ProfileForm` hiện có |
| 03 · Đặt lịch khám | Chọn thông tin khám và khung giờ theo thiết kế, chuyển dữ liệu lựa chọn sang bước xác nhận. Nhận dữ liệu danh mục từ Huy |
| 05 · Lịch khám của tôi | Danh sách và chi tiết lịch. Bao phủ 05.01 Chờ thanh toán, 05.02 Xác nhận hủy, 05.03 Hoàn tiền đã yêu cầu, 05.04 Đã hoàn tiền, 05.05 Hoàn tiền thất bại, 05.06 Kết quả xét nghiệm đã công bố, 05.07 Toa thuốc đã ký/chỉ đọc, 05.08 Đã hủy/chưa thu phí |
| 08 · Tiếp nhận bệnh nhân | Bao phủ 08.01 Đang tiếp nhận lượt khám, 08.02 Đã check-in/cấp số lần đầu, 08.03 Quay lại sau xét nghiệm, 08.04 Tiếp nhận lại đúng lượt cũ |
| 11 · Cấp phát thuốc | Bao phủ 11.01 Thiếu tồn/không giữ một phần, 11.02 Đã giữ đủ toa/15 phút, 11.03 Chờ đồng bộ thanh toán, 11.04 Có thể cấp phát, 11.05 Đã cấp phát, 11.06 Hết hạn giữ thuốc |
| 12 · Tổng quan bệnh viện | Dựng bố cục, bộ lọc và các chỉ số có trong frame. Đối chiếu nguồn dữ liệu với owner API trước khi nối dữ liệu |

### Nhiệm vụ triển khai

- Hoàn thiện shell dùng chung, điều hướng theo vai trò và ghép các page do Huy/Hưng bàn giao vào router.
- Chuẩn hóa các thành phần dùng chung cần cho màn hình đã giao như bảng, phân trang, modal xác nhận, trạng thái tải, rỗng và lỗi.
- Hoàn thiện luồng hồ sơ → chọn lịch → xác nhận, luồng xem/hủy lịch và cập nhật trạng thái sau thanh toán hoặc hoàn tiền.
- Ghép nội dung kết quả xét nghiệm và toa đã ký do Huy cung cấp vào nhóm 05. Ghép trạng thái cấp phát do Pharmacy trả về vào giao diện đơn thuốc bệnh nhân hiện có.
- Thực hiện tiếp nhận lần đầu và lượt quay lại, chuyển thông tin ticket sang bàn khám của Huy.
- Hiển thị trạng thái giữ thuốc, thời hạn giữ và điều kiện cấp phát theo dữ liệu dịch vụ. Cập nhật lại dữ liệu sau thao tác để phản ánh kết quả thực tế.
- Kiểm tra responsive theo các frame Trang chủ bệnh nhân 360/768 và bố cục web chính.

### Vị trí code và đầu ra

- Feature tại `apps/web/src/features/patient/`, `appointment/`, `pharmacy/`.
- Shell và route tại `apps/web/src/app/App.tsx`, CSS shell tại `apps/web/src/app/`, UI dùng chung tại `apps/web/src/shared/ui/`.
- Bàn giao danh sách route đã ghép, component dùng chung và dữ liệu ticket cần cho nhóm 06.

## 4. Huy — Bác sĩ, chỉ định, kê đơn và xét nghiệm

### Màn hình và trạng thái

| Nhóm Figma | Phạm vi cần hoàn thiện |
| --- | --- |
| 06 · Bàn khám bác sĩ | Bao phủ 06.01 Đang tiếp nhận lượt khám, 06.02 Khám lần đầu/đúng lượt đã tiếp nhận, 06.03 Đang tiếp nhận lượt quay lại, 06.04 Quay lại sau xét nghiệm/mở lượt cũ |
| 07 · Chỉ định & kê đơn thuốc | Bao phủ 07.01 Đang tạo chỉ định, 07.02 Chờ kết quả/khóa ký, 07.03 Đã lưu toa nháp, 07.04 Đủ điều kiện ký, 07.05 Chỉ định hủy hợp lệ, 07.06 Kết luận đã ký/có thể ký toa, 07.07 Toa đã ký/chỉ đọc, 07.08 Toa nháp đã lưu/vẫn đủ điều kiện ký, 07.09 Toa nháp đã lưu/chưa gửi chỉ định |
| 10 · Không gian xét nghiệm | Bao phủ 10.01 Có thể lấy mẫu, 10.02 Kết quả nháp, 10.03 Chờ duyệt/người nhập, 10.04 Duyệt/người duyệt độc lập, 10.05 Chặn tự duyệt kết quả, 10.06 Cần làm lại, 10.07 Đã công bố |

### Nhiệm vụ triển khai

- Hoàn thiện bàn khám, danh sách lượt và nội dung khám theo Figma, nhận ticket của luồng tiếp nhận do Quân bàn giao.
- Hiển thị tiến trình tiếp nhận bất đồng bộ. Chỉ mở nội dung lượt khám khi API xác nhận đúng lượt.
- Hoàn thiện ghi chú khám, tạo/hủy chỉ định và soạn/lưu toa nháp. Bảo toàn nội dung người dùng khi có lỗi hoặc xung đột phiên bản.
- Ánh xạ đúng điều kiện ký kết luận và ký toa cho các biến thể 07. Kết quả ký kết luận và ký toa cần được thể hiện theo phản hồi riêng của từng thao tác.
- Hoàn thiện queue xét nghiệm, chi tiết mẫu, nhập kết quả, gửi duyệt, duyệt, yêu cầu làm lại và công bố.
- Hiển thị quyền nhập/duyệt theo phiên hiện tại và phản hồi API, bao gồm tình huống chặn người nhập tự duyệt.
- Cung cấp component hoặc dữ liệu hiển thị kết quả đã công bố và toa đã ký cho Quân ghép vào 05.06–05.07.
- Hoàn thiện adapter Catalog phục vụ danh sách chuyên khoa, bác sĩ, dịch vụ, thuốc và xét nghiệm mà các màn đã giao cần sử dụng.

### Vị trí code và đầu ra

- Feature tại `apps/web/src/features/clinical/`, `diagnostic/`, `catalog/`.
- Tận dụng `ClinicalFeature`, `TreatmentPanel`, `DiagnosticFeature` và các API client hiện có.
- Bàn giao component, kiểu dữ liệu, props/callback cần để Quân ghép route và nội dung cho bệnh nhân.

## 5. Hưng — Tài khoản, thanh toán, thu ngân và phiên đăng nhập

### Màn hình và trạng thái

| Nhóm Figma | Phạm vi cần hoàn thiện |
| --- | --- |
| 01 · Đăng nhập | Màn chính và 01.01 Đăng ký tài khoản, 01.02 Email không hợp lệ, 01.03 Xác thực tài khoản, 01.04 Mã sai, 01.05 Mã hết hạn, 01.06 Đăng ký thành công, 01.07 Quên mật khẩu, 01.08 Phản hồi chung & OTP, 01.09 Mã sai hoặc hết hạn, 01.10 Đặt mật khẩu mới, 01.11 Đổi mật khẩu thành công, 01.12 Đăng nhập bác sĩ/nhân viên, 01.13 Phiên mẫu theo quyền được cấp |
| 04 · Xác nhận & thanh toán | Bao phủ 04.01 Đang tạo khoản thu, 04.02 Chờ thanh toán, 04.03 Đang xử lý thanh toán, 04.04 Thanh toán thất bại, 04.05 Lịch đã xác nhận, 04.06 Hết hạn giữ chỗ, 04.07 Chọn thanh toán tại quầy, 04.08 Đang tạo khoản thu tại quầy, 04.09 Lịch chờ thanh toán tại quầy |
| 09 · Thu ngân & viện phí | Bao phủ 09.01 Đang xử lý thu tại quầy, 09.02 Thất bại, 09.03 Thành công, 09.04 Biên nhận viện phí, 09.05 Hoàn tiền đã yêu cầu, 09.06 Đã hoàn, 09.07 Hoàn thất bại, 09.08 Thu phí khám chờ thanh toán, 09.09 Đang thu phí khám, 09.10 Phí khám đã thu/lịch xác nhận, 09.11 Biên nhận phí khám |

### Nhiệm vụ triển khai

- Hoàn thiện đăng nhập, đăng ký, OTP và khôi phục mật khẩu từ các page hiện có, bảo đảm thông báo và điều hướng đúng frame.
- Cung cấp shared transport/session cho toàn bộ web, thông tin vai trò/capability, xử lý hết phiên và đăng xuất.
- Với frame 01.13, đối chiếu cách dùng phiên mẫu với cơ chế phát triển hiện có. Phân quyền của luồng chạy thực tế lấy từ phiên đã xác thực.
- Chủ trì phần xác nhận và thanh toán nhóm 04. Nhận lựa chọn lịch, hồ sơ và định danh lịch từ Quân, ghép dữ liệu Appointment với trạng thái Billing.
- Hoàn thiện chọn phương thức, tiến trình tạo khoản thu, chờ xử lý, thất bại và hết hạn giữ chỗ. Chỉ hiển thị lịch xác nhận khi dữ liệu Appointment xác nhận trạng thái đó.
- Hoàn thiện queue thu ngân, thu phí, chi tiết khoản thu, biên nhận và tiến trình hoàn tiền. Cung cấp trạng thái/khối hiển thị để Quân dùng trong nhóm 05.
- Cung cấp hợp đồng trạng thái thanh toán cho Huy dùng ở xét nghiệm và Quân dùng ở cấp phát thuốc.

### Vị trí code và đầu ra

- Feature tại `apps/web/src/features/identity/`, `billing/`, `notification/` khi có phần được thiết kế.
- Shared API/session theo `apps/web/src/app/runtime.ts` và `apps/web/src/shared/api/`.
- Bàn giao các page Billing, props/callback, dữ liệu phiên và hướng dẫn ghép với route hiện có. Quân thực hiện phần đăng ký route trong shell.

## 6. Điểm phối hợp giữa ba thành viên

| Điểm giao | Người chủ trì | Người phối hợp | Nội dung cần thống nhất |
| --- | --- | --- | --- |
| Đặt lịch 03 → Xác nhận/thanh toán 04 | Quân ở 03, Hưng ở 04 | Huy cung cấp Catalog | ID hồ sơ, dịch vụ/bác sĩ/slot, thời hạn giữ chỗ, giá và trạng thái lịch/khoản thu |
| Hủy lịch và hoàn tiền 05 ↔ 09 | Quân ở 05, Hưng ở 09 | — | Kết quả hủy lịch, trạng thái hoàn tiền, thông báo chờ và thất bại |
| Tiếp nhận 08 → Bàn khám 06 | Quân ở 08, Huy ở 06 | Hưng cung cấp session | Ticket ID/version, bác sĩ, FIRST/RETURN và cách mở lại lượt cũ |
| Chỉ định 07 → Thu phí 09 → Xét nghiệm 10 | Huy | Hưng | Order/charge ID, trạng thái thanh toán và điều kiện lấy mẫu |
| Toa ký 07 → Nhà thuốc 11 | Huy ở 07, Quân ở 11 | Hưng cung cấp Billing | Toa đã ký, giữ thuốc, thời hạn, trạng thái thu tiền và điều kiện cấp phát |
| Nội dung bệnh nhân 05.06–05.07 | Quân | Huy | Nội dung kết quả đã công bố và toa đã ký, quyền đọc và điều hướng |
| Tổng quan 12 | Quân | Huy và Hưng | Nguồn, ý nghĩa và thời điểm cập nhật của từng chỉ số trên thiết kế |
| Shell và phiên đăng nhập | Quân ở shell, Hưng ở session | Huy tích hợp feature | Props ổn định, menu theo vai trò, xử lý 401/403, reset dữ liệu khi đổi tài khoản |

## 7. Thứ tự triển khai đề xuất

| Đợt | Quân | Huy | Hưng | Mốc kiểm tra |
| --- | --- | --- | --- | --- |
| 1 | Chốt shell, shared UI và route cho các nhóm | Chốt đầu vào component Clinical/Diagnostic và dữ liệu Catalog | Chốt shared transport/session và các page tài khoản | Ba người mở được feature trong cùng ứng dụng và cùng cơ chế phiên |
| 2 | Trang chủ, 02, 03, 05 và 08 | 06, 07 và nội dung kết quả/toa cho bệnh nhân | 01, 04 và thu phí khám trong 09 | Chạy được luồng đăng nhập → đặt lịch → thanh toán → tiếp nhận → mở bàn khám |
| 3 | 11, ghép 05.06–05.07 và 12 | 10, hoàn thiện điều kiện ký/duyệt và lượt quay lại | Hoàn thiện 09, biên nhận, hoàn tiền và trạng thái bất đồng bộ | Chạy được luồng chỉ định → thu tiền → xét nghiệm → ký → cấp phát |
| 4 | Kiểm tra điều hướng và responsive toàn ứng dụng | Kiểm tra quyền, bản nháp, ký và công bố | Kiểm tra hết phiên, lỗi giao dịch và thử lại | Đối chiếu đủ frame, xử lý lỗi và ghi bằng chứng bàn giao |

## 8. Tiêu chí hoàn thành cho mỗi nhóm màn hình

- [ ] Bố cục, nội dung, màu sắc, typography, khoảng cách và tương tác được đối chiếu trực tiếp với frame Figma tương ứng.
- [ ] Các frame trạng thái trong bảng phân công đã có cách tái hiện bằng dữ liệu hoặc kịch bản kiểm tra xác định.
- [ ] Hoạt động qua route và menu của ứng dụng chung, dùng shared session/API của nhóm.
- [ ] Hiển thị được trạng thái tải, dữ liệu rỗng, lỗi, quyền truy cập và kết quả thao tác phù hợp.
- [ ] Các thao tác gửi dữ liệu xử lý double click, phản hồi chậm, thử lại và xung đột theo hợp đồng API. Cùng một ý định thử lại giữ khóa idempotency khi API yêu cầu.
- [ ] Form có nhãn, lỗi nhập liệu rõ ràng, modal và thao tác chính sử dụng được bằng bàn phím.
- [ ] Đã kiểm tra ở kích thước frame gốc và các biến thể responsive đã chuẩn bị, đặc biệt Trang chủ bệnh nhân 360/768.
- [ ] Chạy `npm run typecheck`, `npm test` và `npm run build` trong `apps/web`. Ghi lỗi tồn tại cùng phạm vi ảnh hưởng nếu có.
- [ ] Bàn giao kèm danh sách frame/route đã làm, commit hoặc PR, ảnh đối chiếu và kịch bản kiểm tra luồng liên thành viên.

## 9. Phần cần xác nhận khi triển khai

- Trên Web UI có ghi chú **Cần bổ sung màn Thông báo**. Hưng làm đầu mối nhận thiết kế và nối Notification sau khi màn này được chuẩn bị, Quân phối hợp vị trí mở từ shell. Phần giao diện này đang chờ thiết kế.
- Chức năng Catalog và quản lý lịch làm việc đã có code/route trong repo. Huy giữ đầu mối Catalog, Quân giữ đầu mối quản lý lịch. Cần đối chiếu frame liên quan trước khi xác định phần chỉnh giao diện ngoài danh sách 12 nhóm đã kiểm kê.
- Một số nhóm đã có page, API client và route. Mỗi người rà soát phần mình đang có trước khi ước lượng công việc còn lại. Tài liệu này chưa xác nhận chất lượng hoặc mức hoàn thiện của code hiện tại.
- Nhóm chốt thời hạn và ước lượng sau khi từng thành viên đối chiếu frame chi tiết với code/API thực tế. Bốn đợt ở trên thể hiện thứ tự phụ thuộc để phối hợp.
