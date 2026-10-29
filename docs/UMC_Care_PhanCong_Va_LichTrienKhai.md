# PHÂN CÔNG VÀ LỊCH TRIỂN KHAI UMC CARE

**Nhóm:** Huy – Quân – Hưng | **Thời gian:** 19 tháng 10 đến 23 tháng 11 năm 2026  
**Mục đích:** Giao việc đến từng API, màn hình, tích hợp và kiểm thử để ba thành viên có thể bắt đầu code ngay, cùng theo dõi một bản tích hợp chạy được mỗi tuần. Tài liệu này là kế hoạch; trạng thái hoàn thành chỉ được xác nhận bằng PR, CI và demo thực tế.

---

## Quyết định đã chốt

| Quyết định đã chốt | Nội dung |
| :--- | :--- |
| **Cách chia người** | Mỗi người làm backend và web cho ba service mình sở hữu. Hưng làm thêm ứng dụng Android bằng Kotlin (Android chỉ dành cho bệnh nhân - PATIENT). |
| **Phạm vi** | 9 service; 86 HTTP operations theo API v5.2 (trong đó 3 recovery adapter tắt theo profile chuẩn); 18 events và 5 commands. Web phục vụ đủ 3 actor: PATIENT, DOCTOR, STAFF. |
| **Thời gian** | Hạn nộp **23/11/2026**; mỗi người cam kết khoảng 20–24 giờ/tuần. Mốc tuần là điều kiện tích hợp, không chỉ tính theo số lượng API đã viết. |
| **Nguồn hợp đồng** | BRD, SRS, UC, ERD v5 và API v5.2; tài liệu kiến trúc và Saga giải thích cách triển khai. Khi có mâu thuẫn, mở issue và cập nhật đồng bộ các hợp đồng liên quan. |

---

## 1. Phân công thường trực

| Thành viên | Phạm vi chịu trách nhiệm |
| :--- | :--- |
| **Quân** | <ul><li>**Backend:** Patient (`PT-001–005`); Appointment (`AP-004–006`, `AP-008–019`); Pharmacy (`PH-001–008`). Công nghệ: Node.js/TypeScript, 3 DB MongoDB logic.</li><li>**Web và việc chung:** Hồ sơ bệnh nhân, slot/đặt–đổi–hủy lịch, quầy tiếp nhận/queue và nhà thuốc. Phụ trách web shell, hiển thị trạng thái `PENDING`/lỗi; Docker Compose, MongoDB replica set, RabbitMQ cơ bản.</li><li>**Kiểm thử:** Tranh slot cuối, lịch trùng giờ, hold hết hạn, tồn kho/giữ toàn toa, replay không đặt/cấp trùng.</li></ul> |
| **Huy** | <ul><li>**Backend:** Catalog (`CA-001–006`); Clinical (`CL-001–011`); Diagnostic (`DI-001–013`). Công nghệ: Go, 3 DB PostgreSQL logic.</li><li>**Web và việc chung:** Danh mục công khai, web bác sĩ, LAB kỹ thuật viên / người duyệt, hồ sơ đã công bố. Phụ trách CI, đối chiếu OpenAPI/event schema và ma trận truy vết.</li><li>**Kiểm thử:** Giá snapshot, queue claim, visit/LAB state, người nhập không tự duyệt, kết quả nháp không để lộ.</li></ul> |
| **Hưng** | <ul><li>**Backend:** Identity (`IA-001–014`); Billing (`BI-001–010`, `BI-013–014`); Notification (`NO-001–002`). Công nghệ: Django, 3 DB PostgreSQL logic.</li><li>**Web và việc chung:** Web đăng ký/OTP/đăng nhập/phân quyền/thu–hoàn/thông báo/báo cáo; Envoy/JWT. Toàn bộ ứng dụng Android Kotlin cho PATIENT, sử dụng cùng API Gateway.</li><li>**Kiểm thử:** Auth/capability/ownership, thanh toán và hoàn tiền trùng, Saga `IN_DOUBT`/retry, đồng bộ trạng thái Web–Android.</li></ul> |

> **Khối lượng theo catalogue:** Quân 28 API, Huy 30 API, Hưng 28 API.  
> Ứng dụng Android khiến tải công việc của Hưng cao nhất; Quân và Huy phải giao API ổn định, cung cấp dữ liệu seed và hỗ trợ kiểm thử cho app đúng mốc. Tuyệt đối không tạo backend Android riêng.

---

## 2. Lịch chi tiết và mốc nghiệm thu

### Tuần 1: Từ 19 đến 25 tháng 10

| Ngày | Nhiệm vụ và kết quả kiểm tra |
| :--- | :--- |
| **19/10** | <ul><li>**Quân:** Tạo issue cho PT/AP/PH; chốt index/transaction MongoDB.</li><li>**Huy:** Đối chiếu 4 contract gap với ERD/SRS/API; tạo issue cần sửa.</li><li>**Hưng:** Chốt JWT/capability; tạo issue IA/BI/NO và danh sách màn hình Android.</li><li>**Kết quả:** Thống nhất contract, tên service, response lỗi, event envelope, idempotency.</li></ul> |
| **20–21/10** | <ul><li>**Quân:** Compose MongoDB replica set, RabbitMQ; skeleton 3 service và web shell.</li><li>**Huy:** CI build/test và skeleton 3 Go service, migrations PostgreSQL; web routing.</li><li>**Hưng:** Envoy route/JWT và skeleton 3 Django service; khởi tạo Android Kotlin project / API client.</li><li>**Kết quả:** Chạy Gateway + 9 health endpoints + DB/broker từ Docker Compose.</li></ul> |
| **22–24/10** | <ul><li>**Quân:** `PT-001–005`, `AP-004–006`; web hồ sơ, schedule/slot.</li><li>**Huy:** `CA-001–006`; web danh mục/bác sĩ/giá.</li><li>**Hưng:** `IA-004–006`, `IA-010`; web login/session; Android login.</li><li>**Kết quả:** Mỗi API có contract, auth, test tối thiểu, PR review.</li></ul> |
| **25/10** | <ul><li>**Quân:** Kiểm tra slot và hồ sơ bằng data seed.</li><li>**Huy:** Kiểm tra giá/catalog, CI.</li><li>**Hưng:** Kiểm tra token/route Android.</li><li>**Kết quả:** **Gate 1:** Demo login → hồ sơ → danh mục → slot thông qua Gateway.</li></ul> |

---

### Tuần 2: Từ 26 tháng 10 đến 1 tháng 11

| Ngày | Nhiệm vụ và kết quả kiểm tra |
| :--- | :--- |
| **26–28/10** | <ul><li>**Quân:** `AP-008–012`: hold 10 phút, đặt lịch, danh sách/chi tiết; web booking.</li><li>**Huy:** `CL-001–004`: worklist, start/draft visit; web bác sĩ.</li><li>**Hưng:** `IA-001–003`, `IA-007–009`: đăng ký/OTP/quên–đổi mật khẩu; Android hồ sơ/catalog/slot.</li><li>**Kết quả:** Chốt contracts `RequestCharge`, `ChargePrepared`, `ChargePaid` và `ClaimQueueTicket`.</li></ul> |
| **29–31/10** | <ul><li>**Quân:** Outbox `RequestCharge`, xử lý `ChargePaid`, retry/idempotency; test tranh slot cuối.</li><li>**Huy:** Unit test visit/queue; review booking contract và giá snapshot.</li><li>**Hưng:** `BI-002`, `BI-004`, `BI-013`; Billing command consumer/settlement, web thu tiền mô phỏng.</li><li>**Kết quả:** Tích hợp booking → Billing → `CONFIRMED`, hiển thị trạng thái `PENDING`.</li></ul> |
| **01/11** | <ul><li>**Quân:** Demo tranh slot cuối và đặt trùng request.</li><li>**Huy:** Đối chiếu contract/API và log `correlationId`.</li><li>**Hưng:** Demo đăng ký/login và thanh toán.</li><li>**Kết quả:** **Gate 2:** Đặt lịch + thanh toán + xem trạng thái chạy thành công từ Compose sạch.</li></ul> |

---

### Tuần 3: Từ 2 đến 8 tháng 11

| Ngày | Nhiệm vụ và kết quả kiểm tra |
| :--- | :--- |
| **02–04/11** | <ul><li>**Quân:** `AP-013–019`: đổi/hủy/check-in/queue/no-show/summary; web quầy tiếp nhận.</li><li>**Huy:** `CL-005–010`: chỉ định LAB, toa `DRAFT`/`FINAL`, ký visit; web bác sĩ.</li><li>**Hưng:** `BI-003`, `BI-005–009`, `BI-014`: thu quầy, receipt, refund và retry; web cashier.</li><li>**Kết quả:** Chốt dữ liệu `refundStatus`, `cancellationId` và trạng thái LAB lỗi trước khi merge.</li></ul> |
| **05–07/11** | <ul><li>**Quân:** Tích hợp `VisitSigned` / `QueueTicketClaimed`; kiểm tra refund sau hủy/đổi lịch.</li><li>**Huy:** `DI-002–006`: order, specimen, reject/recollect; web LAB kỹ thuật viên.</li><li>**Hưng:** Android đặt/đổi/hủy, phí/hoàn tiền và polling `statusUrl`; test token refresh.</li><li>**Kết quả:** Demo xử lý lỗi: refund `FAILED` → retry; sample `REJECTED` → recollect.</li></ul> |
| **08/11** | <ul><li>**Quân:** Chạy E2E luồng không LAB và kiểm tra tranh slot.</li><li>**Huy:** Chạy E2E khám không LAB, LAB đến bước lấy mẫu.</li><li>**Hưng:** Kiểm tra Web/Android hiển thị đồng bộ cùng appointment/charge.</li><li>**Kết quả:** **Gate 3:** Hoàn tất luồng không LAB trọn vẹn; đổi/hủy/hoàn tiền; LAB có order và mẫu bệnh phẩm.</li></ul> |

---

### Tuần 4: Từ 9 đến 15 tháng 11

| Ngày | Nhiệm vụ và kết quả kiểm tra |
| :--- | :--- |
| **09–11/11** | <ul><li>**Quân:** `PH-001–008`: nhập tồn, giữ toàn toa, commit/dispense; web dược.</li><li>**Huy:** `DI-007–011`: nhập kết quả, submit, return rework, publish; web LAB review.</li><li>**Hưng:** `IA-011–014`, `BI-001`, `BI-010`, `NO-001–002`; web admin/notification/report.</li><li>**Kết quả:** 3 adapter phục hồi `IA-014` / `DI-001` / `BI-001` giữ tắt trên Gateway.</li></ul> |
| **12–14/11** | <ul><li>**Quân:** Test thiếu thuốc, hold 15 phút, không dispense trùng; sửa tích hợp Billing.</li><li>**Huy:** `CL-011`, `DI-001`, `DI-012–013`; web hồ sơ / kết quả công bố; self-review test.</li><li>**Hưng:** Android hiển thị kết quả `PUBLISHED`, receipt, notification; test auth/capability.</li><li>**Kết quả:** Tích hợp thành công luồng: có LAB → toa `FINAL` → giữ thuốc → `PAID` → cấp phát thuốc.</li></ul> |
| **15/11** | <ul><li>**Quân:** Demo dược và restart consumer.</li><li>**Huy:** Demo LAB publish (người nhập khác người duyệt).</li><li>**Hưng:** Build APK và demo cùng tài khoản bệnh nhân trên web.</li><li>**Kết quả:** **Gate 4:** Web đủ 3 actor, Android cho bệnh nhân, 2 hành trình khám bệnh chạy thông suốt end-to-end.</li></ul> |

---

### Tuần 5: Từ 16 đến 23 tháng 11

| Ngày | Nhiệm vụ và kết quả kiểm tra |
| :--- | :--- |
| **16–18/11** | <ul><li>**Quân:** Concurrency/transaction/index; Compose seed/reset, RabbitMQ/MongoDB restart.</li><li>**Huy:** Rà soát contract 86 API, 18 events / 5 commands, test quyền LAB, benchmark NFR.</li><li>**Hưng:** Security matrix, Saga timeout / `IN_DOUBT` / refund, Android build test.</li><li>**Kết quả:** Mỗi lỗi đều có issue, owner, các bước tái hiện, log `correlationId`.</li></ul> |
| **19–20/11** | <ul><li>**Quân:** Sửa lỗi slot/thuốc, chạy lại kiểm thử E2E.</li><li>**Huy:** Sửa lỗi visit/LAB, tổng hợp bằng chứng đo lường.</li><li>**Hưng:** Sửa lỗi auth/billing/app; từ ngày 20/11 đóng băng tính năng, chỉ nhận bug fix.</li><li>**Kết quả:** CI xanh toàn bộ, seed lại dữ liệu và chạy toàn bộ kịch bản demo.</li></ul> |
| **21/11** | <ul><li>**Quân:** Trình bày ownership MongoDB và xử lý lỗi oversell.</li><li>**Huy:** Trình bày bounded context, LAB, quản lý contract.</li><li>**Hưng:** Trình bày Gateway/JWT, Saga thanh toán và Kotlin Android.</li><li>**Kết quả:** Diễn tập bảo vệ: mỗi người tự chạy phần mình, luân phiên đóng vai giảng viên hỏi vặn lỗi.</li></ul> |
| **22/11** | <ul><li>**Quân:** Chốt Compose/README và sao lưu bản nộp.</li><li>**Huy:** Chốt sơ đồ kiến trúc, báo cáo / bằng chứng kiểm thử (test evidence).</li><li>**Hưng:** Chốt file APK, web auth, danh sách tài khoản demo.</li><li>**Kết quả:** Dựng lại hệ thống từ máy sạch, mở PR release `develop` → `main` sau review, khóa bản nộp.</li></ul> |
| **23/11** | <ul><li>**Quân - Huy - Hưng:** Cùng nộp bài và tham gia bảo vệ đồ án.</li><li>**Kết quả:** Sử dụng chung một bản source code, tài liệu và file APK đã được kiểm chứng.</li></ul> |

---

## 3. Quy định GitHub và Tích hợp

| Chủ đề | Quy định của nhóm |
| :--- | :--- |
| **Nhánh (Branches)** | <ul><li>`main`: Bản ổn định chính thức để nộp đồ án.</li><li>`develop`: Nhánh tích hợp thường trực.</li><li>Mỗi issue tạo nhánh ngắn theo quy ước `feature/ten-api` hoặc `fix/ten-loi`; tạo PR vào `develop`.</li><li>**Nghiêm cấm:** Không push code trực tiếp hoặc force-push lên `main` và `develop`.</li></ul> |
| **Quản lý Issue** | Ghi rõ: Owner, API ID, Màn hình, DB/Event, Phụ thuộc, Điều kiện thành công/lỗi, Test case và Deadline.<br>Luồng Board: `Todo` → `In progress` → `In review` → `Integrated` → `Done`.<br>*Một thành viên không ôm quá 2 issue đang code cùng lúc.* |
| **Pull Request (PR)** | Một PR phải gắn với issue, mô tả rõ trước/sau, thay đổi API & schema, migration, ảnh chụp màn hình hoặc request mẫu, kết quả test đã chạy.<br>Yêu cầu tối thiểu một thành viên khác review và CI pass; thay đổi message/API giữa hai service phải được cả hai owner xác nhận. |
| **Merge và Release** | Ưu tiên PR nhỏ (theo một luồng hoặc 1–3 API liên quan). Merge vào `develop` thường xuyên, không giữ nhánh cá nhân cả tuần.<br>Chỉ tạo PR `develop` → `main` khi chạy lại Docker Compose từ máy sạch, seed data, test E2E thành công và build web/APK hoàn tất. |
| **CI / Automation** | Kích hoạt theo đường dẫn thay đổi: lint/test/build service; kiểm tra OpenAPI/event schema; build web; build Android đối với PR ảnh hưởng app; quét bảo mật không commit secret.<br>Tên các job CI cần đặt ổn định và dễ đọc. |
| **Secrets và Dữ liệu** | Chỉ commit `.env.example`, **tuyệt đối không commit** `.env`, token, mật khẩu, private key hoặc dữ liệu bệnh nhân thật.<br>Dữ liệu seed bắt buộc dùng thông tin giả lập. Không ghi OTP/token và chi tiết bệnh án nhạy cảm vào log. |
| **Review xoay vòng** | <ul><li>PR của Quân: Huy review.</li><li>PR của Huy: Quân review.</li><li>PR của Hưng: Huy hoặc Quân review.</li><li>Các thay đổi liên quan đến thanh toán, giữ slot, LAB hoặc thuốc cần thêm owner phía đối ứng xác nhận contract.</li></ul> |

---

## 4. Quy định kỹ thuật không được bỏ qua

1. **Ranh giới cơ sở dữ liệu:** Mỗi service chỉ ghi vào DB logic của chính mình; tuyệt đối không `JOIN`, tạo khóa ngoại `FK` hoặc query trực tiếp DB của service khác.
2. **Giao tiếp Client qua Gateway:** Mọi request từ Client (Web/Android) luôn đi qua Envoy Gateway; service owner chịu trách nhiệm phân quyền theo tài nguyên và trạng thái thực tế.
3. **Giao tiếp bất đồng bộ & Saga:** Nghiệp vụ xuyên service sử dụng command/event qua RabbitMQ, triển khai mô hình Outbox/Inbox pattern, deduplication và retry. Request bất đồng bộ trả mã `202 Accepted` kèm `statusUrl`; Web/Android phải hiển thị trung thực trạng thái `PENDING` hoặc `IN_DOUBT`.
4. **Chuẩn hóa API:** API phải bám sát workbook v5.2 về HTTP method, route, tham số, cấu trúc response và mã lỗi. Mọi thay đổi contract phải tạo issue và PR riêng, cập nhật đồng bộ SRS/ERD/API, không tự ý sửa một phía.
5. **Đóng 4 khoảng trống (Gap) trước khi code:**
   - Trạng thái `DISPENSED` của medication hold.
   - Nguồn xác thực trạng thái hoàn tiền `refundStatus`.
   - Cơ chế `cancellationId` chống hoàn tiền trùng lặp.
   - Trạng thái LAB `REJECTED`/`FAILED` và quy tắc ký/resubmit kết quả.
6. **Yêu cầu tối thiểu mỗi service:** Mỗi service phải có endpoint health check, migration/index, kiểm thử bất biến (invariant), ghi log kèm `correlationId` và script seed dữ liệu.
7. **Nền tảng Android:** Android Kotlin dùng chung các endpoint API Gateway với Web, không tạo bảng dữ liệu hay backend riêng cho mobile.

---

## 5. Định nghĩa Hoàn thành và Nhịp làm việc

### Tiêu chí hoàn thành (Definition of Done)

| Loại việc | Chỉ đánh dấu Done khi |
| :--- | :--- |
| **API / Backend** | Khớp 100% đặc tả OpenAPI; kiểm tra auth/capability/ownership; có validation/error/idempotency; hoàn thành migration/index; có unit/integration test; có log `correlationId`; PR được review và CI xanh. |
| **Web / Android** | Xử lý đầy đủ các trạng thái giao diện: loading, empty, 401/403, conflict, pending, retry và hiển thị dữ liệu thật từ Gateway; không hard-code kết quả. Android chỉ phục vụ vai trò PATIENT. |
| **Luồng liên service** | Có hợp đồng event/command rõ ràng, áp dụng outbox/inbox, kiểm thử kịch bản duplicate/restart/timeout/compensation, client đọc được trạng thái cuối cùng chính xác. |
| **Mốc tuần (Gate)** | Cả nhóm khởi chạy thành công Docker Compose từ dữ liệu seed sạch, demo được ít nhất một luồng thành công và một luồng lỗi, lưu kết quả test/screenshot/log vào issue hoặc báo cáo. |

### Nhịp làm việc nhóm (Team Cadence)
* **Hàng ngày:** Cập nhật tiến độ trên Issue và họp nhanh (Daily Standup) 15 phút.
* **Thứ Tư:** Tích hợp giữa tuần (Mid-week integration).
* **Thứ Sáu:** Rà soát và review Pull Request tập trung.
* **Chủ Nhật:** Kiểm tra mốc demo tuần (Gate Check). *Nếu mốc chưa chạy thông suốt, cả nhóm ưu tiên xử lý điểm tích hợp bị gãy trước khi mở thêm việc mới.*

> **Đánh giá tải công việc:**  
> 3 thành viên × 20–24 giờ/tuần × 5 tuần = **300–360 giờ làm việc**.  
> Khối lượng 86 API + giao diện Web 3 actor + ứng dụng Android Kotlin là một phạm vi rất căng. Giữ Android ở mức tối giản theo chuẩn, tái sử dụng contract/skeleton và kiểm thử theo luồng ngay từ Tuần 1; tuyệt đối không thêm Kubernetes, BFF, GraphQL hoặc tính năng ngoài baseline khi hai hành trình khám chính chưa ổn định.

---

## 6. Nguồn tài liệu đối chiếu

* **Tài liệu dự án UMC Care:** BRD, SRS, UC, ERD v5 ngày 17/10/2026; API workbook v5.2; Tài liệu kiến trúc và Saga UMC Care.
* **Quy chuẩn quản lý nhánh & GitHub:** [GitHub Docs - About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
* **Kiến trúc Android chuẩn:** [Android Developers - Architecture recommendations](https://developer.android.com/topic/architecture/recommendations).
