# Gate 4 — hai hành trình tích hợp Pharmacy

Trạng thái 07/11/2026: NOT RUN. Unit/Mongo fixtures không phải bằng chứng Gate 4.
Quân giao phần Patient/Appointment/Pharmacy + shell; Huy xác nhận Catalog/Clinical/Diagnostic;
Hưng xác nhận Identity/Billing/Notification/Android. Mỗi người tự chạy receiver trước khi ký.

## Chuẩn bị và dấu vết

1. Ghi source commit, URL CI của đúng commit, phiên bản image và môi trường vào biên bản local.
2. Làm theo `infra/compose/README.md`, chạy `tools/quan/check-stack.ps1`; đủ chín ready.
3. Dùng tài khoản giả do Identity cấp: PATIENT, RECEPTION, DOCTOR được phân công, PHARMACY;
   thêm LAB_TECH và LAB_REVIEW là hai người khác nhau cho hành trình có LAB.
4. Catalog owner phát MEDICINE/PRICE_VERSION và stream bootstrap đầy đủ, checkpoint <=30s.
   Quân không tự xóa gap hoặc ghi projection giả để làm gate xanh.
5. PatientAccessChanged, IdentityAccessChanged và Clinical FINAL phải đến từ worker owner thật.
6. Web runtime của Hưng cung cấp transport, session và `lease(action)`; token không lưu trong evidence.
   PH002..PH008 dùng X-Authorization-Lease, action tương ứng PH002..PH008, <=30s, đúng sub/tokenVersion.
7. Chỉ ghi ID giả, correlationId, thời điểm và trạng thái vào evidence; không ghi bearer/lease, OTP hoặc bệnh án.

## Hành trình không LAB

| Bước                       | Owner/API                            | Kết quả phải thấy                                                           |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| Đăng nhập, tạo/chọn hồ sơ  | Hưng IA / Quân PT                    | Đúng patient ownership                                                      |
| Giữ slot, đặt lịch         | Quân AP-008/AP-010                   | Một hold, appointment PENDING_PAYMENT; charge qua outbox                    |
| Thanh toán lịch            | Hưng BI + Quân AP                    | Reserve/Reserved + ChargePaid/Decision đúng fence; CONFIRMED                |
| Check-in, gọi, claim FIRST | Quân AP + Huy CL                     | Một ticket; doctor/department mapping có nguồn                              |
| Khám, ký, FINAL            | Huy CL                               | PrescriptionFinalized envelope, revision và medicineCode thật               |
| Tiếp nhận toa              | Quân PH-003/004                      | Thấy FINAL qua Gateway, patient chỉ thấy trạng thái tối thiểu               |
| Giữ toàn toa               | Quân PH-005                          | 202, holdId/statusUrl; reserved tăng nguyên tử; onHand chưa giảm            |
| Thanh toán thuốc           | Hưng BI + Quân PH                    | Cùng sourceId/attempt; fence số nguyên; hai bằng chứng cục bộ → COMMITTED   |
| Phát thuốc                 | Quân PH-008                          | Một dispense; onHand và reserved cùng giảm một lần; MedicationDispensed     |
| Theo dõi                   | Hưng Android/Notification + Quân web | Trạng thái patient giống owner; Notification không phải bằng chứng thu tiền |

## Hành trình có LAB

Lặp phần đặt lịch và FIRST. Clinical tạo registry/order qua command;
Diagnostic nhận order và Billing thu tiền bằng settlement handshake.
LAB_TECH lấy mẫu khi PAID cục bộ, nhập DRAFT; LAB_REVIEW khác người nhập duyệt PUBLISHED.
Clinical nhận kết quả, RETURN dùng cùng visit và ticket mapping thật, ký FINAL rồi đi tiếp Pharmacy.
Không dùng POST /diagnostic-orders hoặc POST /charges adapter phục hồi để bỏ qua luồng chuẩn.

## Các ca bắt buộc chạy thêm

- Thiếu thuốc ở dòng thứ hai: không giữ dòng đầu, không hold/RequestCharge rác.
- Retry cùng key/body, duplicate message và phản hồi mạng không rõ: không tạo receipt/hold/dispense đôi.
- Hai người phát cùng version: một thành công; người còn lại nhận conflict và tải lại.
- HELD hết 15 phút được nhả; SETTLEMENT_LOCKED + UNKNOWN vẫn giữ reserved.
- FAILED đến trước Reserve lưu tombstone; reserve đến muộn trả SettlementReserved REJECTED.
- ChargePaid đến trước FAILED mâu thuẫn: giữ payment evidence và khóa, quarantine mâu thuẫn.
- Thanh toán đến muộn/cancellation/refund: Hưng xác nhận refund có cancellationId, không commit attempt mới.
- PATIENT không thấy tồn kho/toa staff hoặc prescription của người khác; sai lease/capability bị chặn.
- Restart broker/worker theo recovery.md, không mất effect sau commit/trước ack.
- Web 360/768/1440, đổi toa và rời trang khi polling; chụp màn hình đã lược dữ liệu nhạy cảm.

## Phiếu nhận

```text
Source commit / CI URL:
Environment / images:
Scenario: no-LAB / LAB / failure:
Owner producer / receiver:
Resource IDs / correlationId:
Observed state and stock before/after:
Commands and exit codes:
Evidence path (local):
Known failure + owner:
Receiver rerun date/result:
Huy:
Hưng:
Quân:
Status: BLOCKED / REVIEW / INTEGRATED
```

Chỉ chuyển INTEGRATED khi có evidence thực tế và người nhận xác nhận.
