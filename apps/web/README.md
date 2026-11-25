# HQH Care web

Web React/TypeScript dùng chung cho PATIENT, DOCTOR và STAFF. **Phân công cập nhật 25/11/2026 theo 138 PDF trong `HQH_Care_web.zip`, code hiện có và backend của từng người** nằm ngay trong thư mục frontend:

**[Phân công chi tiết: màn → người làm → file → API → phần còn lại → tiêu chí bàn giao](PHAN_CONG_VA_QUY_DINH_FRONTEND.md)**

Tài liệu có kiểm kê tên **đủ 138 PDF** (gồm 21 biến thể thông báo đã đọc), việc đã có code, việc cần sửa/thêm, khoảng trống backend và thứ tự ghép. “Có code” không đồng nghĩa đã kiểm thử đầy đủ. Đã đồng bộ `origin/develop` tại commit `b355d60` vào `huy_task` trước phần hoàn thiện Huy; trạng thái bên dưới được cập nhật theo nền này.

## Ai làm phần nào

| Người    | Backend                         | Màn/frontend chốt đầu ra                                                                                                                      | File chính                                                                                           |
| -------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Quân** | Patient, Appointment, Pharmacy  | Shell/menu/router, trang chủ, 02 hồ sơ, 03 đặt lịch, màn cha 05, 08 tiếp nhận, 11/11.07 nhà thuốc; khung 12, 12.02 lịch ca                    | `src/app/App.tsx`, CSS shell, `src/shared/ui/`; `src/features/patient/`, `appointment/`, `pharmacy/` |
| **Huy**  | Catalog, Clinical, Diagnostic   | 06 gồm 06.05/06.06/06.07/06.10; 07; 10; trang 05.06 LAB, 05.07 toa FINAL; 12.01/12.06 giá và danh mục dùng chung                              | `src/features/catalog/`, `clinical/`, `diagnostic/`                                                  |
| **Hưng** | Identity, Billing, Notification | 01; Billing trong 04; 09 thu/hoàn/biên nhận; 12.03 quyền, 12.04 audit, phần Billing của 12.05 báo cáo; thông báo; JWT/lease/refresh/transport | `src/features/identity/`, `billing/`, `notification/`; `src/app/runtime.ts`, `src/shared/api/`       |

- **05.06/05.07 giữ trang riêng** như ZIP: `/patient/lab-results`, `/patient/medical-records`. Quân thêm tab/nút từ lịch khám và giữ hồ sơ/ngữ cảnh; Huy hoàn thiện nội dung. Không chép Clinical/Diagnostic vào Appointment.
- **04 giữ route review hiện có**: Quân bàn giao hold/Appointment, Hưng ghép Billing. Chưa có FE Billing adapter đầy đủ; không coi tạo lịch là đã thanh toán.
- **12 chia theo service**: Quân điều phối khung và ca, Huy giá, Hưng quyền/audit/số thu hoàn; các KPI thiếu API phải ghi rõ chờ nguồn.
- **Thông báo đã đọc làm một lần dùng chung**: Hưng cung cấp component/API, Quân gắn shell. Không sao chép từng page theo biến thể PDF.

## Hiện có và việc cần làm trước

Có các feature Patient/Appointment/Pharmacy, Catalog/Clinical/Diagnostic và page tài khoản Identity. Hai trang Huy đọc kết quả/toa theo hồ sơ đã có adapter, Develop đã có tab/nút và AppointmentRecords của Quân để ghép theo lịch; trang riêng Huy hiển thị theo hồ sơ, giữ patientId qua ba tab và đường quay lại.

Thu ngân `/staff/cashier` hiện còn khung tĩnh; Billing đã có api.ts/types.ts và phần thanh toán ở BookingReview; Notification chưa có FE component. Các page quản trị quyền/audit/Billing report chưa có. Huy đã bổ sung trang `/staff/prices`, API CA-007 đọc lịch sử giá và lease CA-004 khi tạo giá, không thay schema DB. Tài liệu phân công giao rõ Q-01–Q-08, H-01–H-07, U-01–U-09 và B-01–B-08 để xử lý các phần này.

Thứ tự làm: (1) chốt session/props/route/nguồn API; (2) hồ sơ → đặt lịch → thanh toán → 05 và hai trang Huy; (3) tiếp nhận → khám → LAB → ký → thuốc/hoàn; (4) quản trị/thông báo và đối chiếu đủ PDF. Mỗi owner tiếp tục sửa phần đã có, không dựng lại ứng dụng.

## Quy tắc tích hợp

Quân chốt `App.tsx` và UI chung; Hưng chốt `runtime.ts`/`shared/api/`; owner feature chốt page/API/types/CSS nghiệp vụ. Gửi props, route, capability, callback và bước kiểm tra cho owner nhận trước khi ghép. Tách thư mục không loại bỏ conflict hoặc lệch hợp đồng.

Mỗi frame trạng thái dùng dữ liệu/trạng thái API tương ứng, không là một route riêng. SELF/OTHER dùng cùng luồng theo owner. Backend quyết định quyền và kết quả nghiệp vụ; FE không tự giả CONFIRMED, PAID, PUBLISHED hoặc FINAL. Không dùng tên/giá/đồng hồ/số đếm trong PDF làm fallback khi API lỗi.

Các thay đổi local đang có phải được giữ an toàn trước khi cập nhật `develop` và tích hợp; không reset hay chép đè phần người khác. Không tự tạo nhánh/preview/stack/env riêng. Bảng owner chi tiết và hợp đồng đi/về ở [mục 6–7 của phân công](PHAN_CONG_VA_QUY_DINH_FRONTEND.md#6-quy-định-file-và-route).

## Chạy ứng dụng chung

### Docker của nhóm

Theo [hướng dẫn Compose chung](../../infra/compose/README.md), nạp đúng ba file env của nhóm. Web tại http://127.0.0.1:15173, Nginx chuyển `/api/v1` về Gateway. Các API/worker dùng database, RabbitMQ, Redis online và cặp JWT hiện có. FE không nhận mật khẩu DB/broker/Redis hoặc private key.

### Phát triển FE bằng Vite

Tại `apps/web`:

```powershell
npm ci
npm run dev
```

Vite mặc định http://127.0.0.1:5173, proxy `/api/v1` tới Gateway http://127.0.0.1:8080. Có thể đặt `HQH_GATEWAY_URL` trong môi trường chạy Vite nếu Gateway ở địa chỉ khác; biến này là URL kết nối, không phải bí mật. Đăng nhập cần Identity/Gateway; dữ liệu nghiệp vụ cần API/worker liên quan. Bộ dữ liệu minh họa không thay thế server thật.

## Nghiệm thu khi code hoàn tất

Trong `apps/web`, các lệnh kiểm tra hiện có:

```powershell
npm run typecheck
npm test
npm run build
```

Sau đó đối chiếu luồng đi/về, refresh/deep link, đổi hồ sơ/tài khoản, loading/rỗng/lỗi, double click/retry/idempotency, expectedVersion/409, hết phiên/lease và quyền. 202 chưa là kết quả cuối, polling phải hủy khi rời màn. ADMIN không tự thay actor DOCTOR/PATIENT hoặc bỏ quy tắc người duyệt độc lập. Phạm vi hiện tại là **web desktop** theo yêu cầu; không mặc định mở rộng kiểm điện thoại.

`tests/fixtures/huy-demo.json` chỉ là fixture kiểm thử. Không fallback fixture thành dữ liệu online khi request lỗi. Không commit env thật, private PEM, token hay log có bí mật. Chạy test mô phỏng/build thành công chưa chứng minh DB/JWT/message liên service đã thông suốt.

Sau cập nhật phân công đã thực hiện code phần Huy, chạy kiểm tra tự động phù hợp; chưa chạy E2E online hoặc ghi/migrate dữ liệu Neon. Runtime Catalog/Clinical đã gỡ seed demo; fixture chỉ dành cho test, không được đưa vào binary. Xem [Clinical](src/features/clinical/README.md), [Diagnostic](src/features/diagnostic/README.md), [shell](src/app/README.md), [shared API](src/shared/api/README.md), [HTTP contracts](../../contracts/http/README.md) và [phân công đầy đủ](PHAN_CONG_VA_QUY_DINH_FRONTEND.md).
