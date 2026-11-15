# Phạm vi và đầu mối của ba người

Bảng này ghi theo phân công nhóm ngày 19/10 và quy định GitHub ngày 24/10. Mỗi người chịu trách nhiệm code, migration, seed, test và README ở service của mình; công việc dùng chung phải qua owner được giao.

| Người | Backend và API | Web | Phần dùng chung/phối hợp |
| --- | --- | --- | --- |
| **Quân** | Patient PT-001–005; Appointment AP-004–006, AP-008–019; Pharmacy PH-001–008 | `apps/web/src/features/patient/`, `appointment/`, `pharmacy/`; shell, route, menu và shared UI | Compose tích hợp, Mongo, RabbitMQ/bindings chung, router/feature registry; nhận giá và giao queue/visit/toa cho Huy |
| **Huy** | Catalog CA-001–006; Clinical CL-001–011; Diagnostic DI-001–013 | `apps/web/src/features/catalog/`, `clinical/`, `diagnostic/` | PostgreSQL/role cho phần chung, CI, hợp đồng và E2E/performance điều phối, tài liệu/traceability; nhận hợp đồng hàng chờ từ Quân và Billing/auth từ Hưng |
| **Hưng** | Identity IA-001–014; Billing BI-001–010, BI-013–014; Notification NO-001–002 | `apps/web/src/features/identity/`, `billing/`, `notification/` | Shared API/session, Envoy/JWT/lease, Android Kotlin PATIENT; nhận order/charge/settlement/kết quả đã công bố từ Huy |

Phân công nền ban đầu ghi Quân 28 API, Huy 30, Hưng 28. Tổng 86 operation; DI-001 là adapter phục hồi tắt mặc định, không thuộc đường client chính. Health/worker không tính vào số API này. Mỗi owner tự xác nhận số lượng theo baseline cuối được cả nhóm duyệt.

## Ranh giới không được vượt

- Mỗi service tự sở hữu DB và dữ liệu. Không JOIN, query hoặc ghi DB service khác; dùng API/message và projection cục bộ.
- Owner feature viết trang/hook/test trong feature của mình. Quân ghép app shell/router; Hưng giữ shared HTTP/session; các feature không import sâu nội bộ của nhau.
- Catalog/Clinical/Diagnostic do Huy sở hữu; Huy không tự sửa Patient/Appointment/Pharmacy hoặc Billing/Identity để làm luồng qua nhanh.
- Người đề xuất thay API/event phải báo consumer, thống nhất schema/version/payload với owner liên quan, rồi cập nhật source, test và tài liệu cùng nhau.
- Android chỉ là client PATIENT của Hưng, gọi cùng Gateway/API; không tạo backend hoặc database riêng.

## Bàn giao theo luồng

| Luồng | Người giao → nhận | Hợp đồng/điều kiện cần chứng minh |
| --- | --- | --- |
| Danh mục và giá | Huy → Quân/Hưng | ID đúng loại; snapshot/version; null khi chưa có giá; giá mới không đổi lịch sử |
| Lượt khám | Quân → Huy | Ticket, FIRST/RETURN, version, patient/doctor đã xác thực; claim lặp một visit |
| Ký khám/RETURN/toa | Huy → Quân | VisitSigned, VisitReturnReady, PrescriptionFinalized; replay không tạo COMPLETED/RETURN/toa đôi |
| LAB và phí | Huy ↔ Hưng | CreateLabOrder/RequestCharge, ChargePrepared, settlement/fence, LabCancelled và refund status |
| Hồ sơ/kết quả | Huy → Hưng | CL-011/DI-013 chỉ trả bản SIGNED/PUBLISHED; web/Android thấy cùng trạng thái |
| Auth và quyền | Hưng → Huy/Quân | JWT/lease/projection, capability và thu hồi quyền; owner API vẫn tự kiểm ownership |

Mỗi giao dịch bàn giao phải có schema/version, request/response hoặc payload ví dụ, lỗi/ca thất bại, seed giả, test chạy được và người nhận xác nhận đã tích hợp. Ảnh UI hoặc tên endpoint chưa đủ.
