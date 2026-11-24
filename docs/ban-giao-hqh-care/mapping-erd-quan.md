# Mapping ERD và MongoDB của Quân

Đối chiếu mục 2, 4 và 7 của ERD v5 với các API v5.2. Bản này ghi đường lưu và nguồn dữ liệu chính để nhóm review chung.

| ERD | Dữ liệu và quy tắc đang dùng |
| --- | --- |
| `patients.birthDate` kiểu date | Chuỗi ngày lịch ISO `YYYY-MM-DD`, khớp OpenAPI format date và không phụ thuộc múi giờ. Kiểm ngày lịch khi tạo hoặc sửa field. `sex` tùy chọn, giá trị mới gồm MALE, FEMALE, OTHER, UNKNOWN. |
| `profile_audit.changedFields` | Lưu tên field nghiệp vụ đã khởi tạo hoặc thay đổi vật lý. PATCH không đổi dữ liệu giữ nguyên version và không tạo audit/outbox. Lịch sử cũ thiếu field vẫn đọc được. |
| `appointments.priceSnapshotVnd`, `priceVersion` | Lịch mới lưu tiền bằng BSON int64 và UUID phiên bản giá ở hai trường đúng tên ERD. Snapshot đầy đủ và hash giữ ở `holds.priceSnapshot` để đối soát. Worker hỗ trợ đọc snapshot lồng cũ khi gặp lịch đã có. |
| `appointments.expiresAt` | Lịch mới lưu hạn thanh toán bằng BSON Date đúng tên ERD. Worker đọc tương thích `paymentDueAt` của lịch cũ. `holds.expiresAt` là hạn giữ slot. `holds.consumedAt` được ghi khi chuyển CONSUMED. |
| `appointments.settlementState`, `settlementVersion` | Giá trị ban đầu NONE/0. Reserve khởi tạo scope mới PENDING/0. Quyết định hợp lệ cập nhật version từ `decisionVersion` theo settlementId và fence. ChargePaid hợp lệ vẫn là tín hiệu cần để chuyển lịch sang CONFIRMED. `sourceRevision`, `fence` và `decisionVersion` có vai trò riêng. |
| `queue_tickets.claimedBy` | Ghi Identity user ID đã được lưu trong ticket.doctorUserId khi claim. Với vé lịch sử thiếu mapping có thể không có claimedBy. `IN_SERVICE` là trạng thái có trong OpenAPI v5.2. |
| `patient_time_locks.intervals[]` | Lock mới lưu `patientId`, `intervals` và `version`. Giữ cơ chế tuần tự hóa theo `patientId` và kiểm tra chống trùng từ hold/lịch trong Mongo transaction. Mảng khoảng giờ đang hoạt động được tái tạo cùng transaction khi hold/lịch đổi trạng thái hoặc slot. |
| Kiểm trùng ca | `schedule_write_locks` là collection kỹ thuật dùng để tuần tự hóa thao tác tạo/sửa ca. Ca và slot thay đổi nguyên tử và giữ ID cho khoảng thời gian không đổi. |
| `prescription_projection` | Dữ liệu mới có id UUID, unique theo prescriptionId/revision và chỉ ghi `linesSnapshot`. Code vẫn đọc `itemsSnapshot` cũ và trả `itemsSnapshot` trên HTTP theo hợp đồng. Dữ liệu cũ có ID ghép vẫn tra theo khóa nghiệp vụ. |
| `medication_holds`, `inventory` | Hold mới có settlementVersion=0. Hold sau khi cấp vẫn lưu `COMMITTED` theo ERD. API trả `DISPENSED` khi có bản ghi `dispenses` liên kết; thời điểm cấp lấy từ bản ghi đó. `inventory.updatedAt` thay đổi cùng transaction nhập, giữ, nhả và cấp thuốc. |

Trước khi triển khai Atlas, kiểm trùng `settlement_decisions` theo settlementId/decisionVersion và xác minh metadata index/validator của collection đã tồn tại. Startup tạo index nhưng không thay cấu hình validator của collection cũ. Chỉ backfill dữ liệu lịch sử khi có bằng chứng cho giá trị và đã xác định ảnh hưởng tới các service tiêu thụ.

