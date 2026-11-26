# Bàn khám và điều trị — Huy

Màn 06 Bàn khám và 07 Chỉ định/kê đơn được triển khai theo bộ Web UI của nhóm. Dữ liệu và thao tác phải tuân theo API, không dựng trạng thái nghiệp vụ theo ảnh mẫu.

## Route và hợp đồng

| Màn               | Route                                                         | API                                                                            |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Bàn khám          | `/doctor/clinical`                                            | CL-001 danh sách/poll; CL-002 nhận vé; CL-003 chi tiết; CL-004 lưu nháp        |
| Chỉ định/kê đơn   | `/doctor/treatment?visitId=UUID` hoặc Tiếp tục chỉ định       | CA-005/006; CL-005 LAB; CL-006/007/008 toa nháp; CL-010 ký khám; CL-009 ký toa |
| Bệnh án/toa đã ký | Tab Lịch sử khám; `/patient/medical-records?patientId=UUID`   | CL-011, lọc SIGNED và FINAL                                                    |
| Kết quả LAB       | Tab Kết quả xét nghiệm; `/patient/lab-results?patientId=UUID` | DI-013, lọc PUBLISHED                                                          |

`ClinicalRoute` nhận ticketId, doctorId, ticketVersion (hoặc expectedTicketVersion) từ tiếp nhận. CL-002 chỉ gửi ba trường này; không gửi patientId tự nhập. URL không cấp quyền khám. Backend kiểm tra vé, bác sĩ và grant.

`ClinicalFeature` nhận api, session và tùy chọn selectedTicket, initialVisitId, initialView, diagnosticApi, patients. `patients` là bản đồ nhân khẩu do host lấy hợp lệ. Khi thiếu, hiện mã hồ sơ; không tự điền tên, tuổi, dị ứng hoặc sinh hiệu. Clinical API hiện chưa trả các trường này. Patient PT-004 cần scoped read cho bác sĩ/nhân viên ở phía Patient; không dùng API nội bộ hoặc bỏ qua phân quyền để bù dữ liệu thiếu.

## Quy tắc nghiệp vụ

1. Nhận khám trả 202/PENDING. Poll CL-001 bằng operationId. Chỉ ACCEPTED có visitId mới mở lượt; REJECTED hiển thị lý do. Khám quay lại cũng cần nhận vé và xác nhận từ Appointment, không tự đổi RETURN_READY/WAITING_RETURN thành IN_PROGRESS.
2. Bệnh án gửi đủ bốn trường và expectedVersion. SIGNED chỉ đọc. Giữ nội dung khi poll LAB, lỗi mạng hoặc 409; chỉ bỏ bản nhập khi người dùng xác nhận. Không chuyển lượt khi thao tác lưu chưa rõ kết quả.
3. Danh mục lấy ACTIVE từ Catalog. CL-005 gửi testId/revision. Không tự tính phí hay đánh dấu đã trả tiền. Poll CL-003 khi registry PENDING hoặc CREATED để nhận kết quả về.
4. REJECTED chưa kết thúc nghĩa vụ LAB. Tạo lại dùng replacesRequestId và expectedSourceVersion do server cung cấp; không tự sửa registry cũ.
5. Ký khám chỉ khi IN_PROGRESS, có chẩn đoán đã lưu, không còn LAB chưa xử lý, chỉ định chưa gửi hoặc toa đang sửa. Chỉ PUBLISHED/CANCELLED/SUPERSEDED kết thúc nghĩa vụ LAB. Backend kiểm tra lại tất cả điều kiện.
6. CL-010 ký kết luận và CL-009 đưa toa sang FINAL là hai thao tác riêng, có xác nhận và kết quả riêng. Không ký toa thứ hai nếu lượt đã có FINAL. Toa FINAL chỉ đọc; nhà thuốc nhận qua backend/message queue.
7. Hủy LAB kiểm tra chưa từng lấy mẫu, chưa thu hoặc đã thu xong và không có settlement đang đối soát rồi gọi DI-012 kèm lý do và expectedVersion. Hủy không đồng nghĩa hoàn tiền thành công; trạng thái hoàn tiền do Billing cập nhật.

## Phiên và an toàn thao tác

Host cung cấp JWT transport và Identity lease. Feature chỉ gọi `/api/v1`, không kết nối DB/RabbitMQ/Redis từ browser. Không chứa private key, mật khẩu backend hoặc token cố định.

```tsx
const api = createClinicalApi(runtime.transport, {
  authorizationLease: (action) => runtime.session!.lease!(action),
});
<ClinicalFeature
  api={api}
  diagnosticApi={diagnosticApi}
  session={runtime.session}
/>;
```

CL-009/010/011 lấy lease mới và gắn X-Authorization-Lease. Callback chỉ được bỏ qua khi transport đã gắn lease tập trung; server vẫn yêu cầu quyền. Mất phản hồi dùng lại cùng body và Idempotency-Key, không tạo giao dịch mới. Bản poll cũ không ghi đè phiên bản vừa được server xác nhận. Lỗi và correlationId được hiển thị, không giả thành công.

LeaveGuard bảo vệ liên kết và đóng/tải lại trang. Không cam kết chặn đầy đủ nút back trong cùng lịch sử SPA. Không lưu nội dung khám vào localStorage.

## Bàn giao và kiểm tra

MedicalHistory, SignedPrescription và PublishedLabResults phục vụ 05.06–05.07. Develop đã có AppointmentRecords của Quân ghép theo lịch; giữ component đó. Hai route riêng của Huy xem theo hồ sơ, có ba tab và đường quay lại lịch giữ patientId. Trang Đơn thuốc dùng prescriptionsOnly để không lẫn nội dung bệnh án. Không có kết quả một trang không đồng nghĩa cả hồ sơ không có dữ liệu.

Chạy `npm ci`, `npm run typecheck`, `npm test`, `npm run build` trong `apps/web`. Kiểm thử Huy tại `tests/huy-workspaces.test.tsx`, `tests/huy-clinical-regression.test.tsx` và `tests/huy-treatment-regression.test.tsx`. Các màn và bài kiểm tra dùng chung React và dependencies của web.

Fixture chỉ dành cho kiểm thử. Nghiệm thu online cần tài khoản thật, grant/projection, migration và dữ liệu nhóm. Build và fixture UI không chứng minh RabbitMQ/DB online đã thông suốt.

## Điều hướng và lượt khám đang chọn

`ClinicalRoute` đồng bộ chuyển Bàn khám/Chỉ định với router; `visitId` được giữ trên URL khi đã chọn lượt. Menu bên trái, vị trí ở thanh trên và tiêu đề trang phải cùng màn. Khi mở Chỉ định mà chưa chọn lượt, giao diện hiển thị hướng dẫn và nút về Bàn khám; không tự chọn người bệnh hoặc tạo lượt mới. Danh sách bên trái là lượt đã được phân công, không phải danh sách vé chờ do Appointment quản lý.

## Dữ liệu và điều hướng 25/11/2026

Clinical/Diagnostic chỉ hiển thị thông tin API cung cấp. Không tự điền dị ứng/sinh hiệu hay tên bác sĩ mẫu. Chọn SELF/OTHER giữ trên URL, hồ sơ không thuộc danh sách owner không tự đổi sang người khác. Parent AppointmentRecords của Quân cung cấp view theo lịch; các trang riêng đọc tất cả dữ liệu đã ký/công bố theo hồ sơ. Migration Clinical không còn cờ seed-demo; importer chỉ nhận export có căn cứ từ owner.
