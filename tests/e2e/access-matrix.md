# Ma trận quyền và retry — Quân tuần 4–5

| Tình huống | Kết quả | Evidence tự động / trạng thái |
| --- | --- | --- |
| PATIENT đúng chủ | PH-004 chỉ PATIENT_STATUS, không stock/items/holds | pharmacy-api.test.js |
| PATIENT hồ sơ khác | 404, không lộ toa | pharmacy-api.test.js |
| PATIENT gọi API kho | 403 | pharmacy-api.test.js |
| STAFF PHARMACY đang ACTIVE | Có quyền nghiệp vụ khi lease đúng | pharmacy-api.test.js |
| STAFF mất quyền/tokenVersion đổi | 403 dù bearer cũ còn hạn | pharmacy-api.test.js |
| Thiếu Identity/patient/Catalog projection | Fail closed, không giả quyền/giá | pharmacy-business.test.js, catalog-projection.test.js |
| Lease hết hạn/sai action/sub/version hoặc >30s | 403; không cộng leeway vào exp | pharmacy-api.test.js dùng RSA thật |
| Lease dùng làm access bearer | Bị từ chối | appointment/tests/lease-identity.test.js |
| DOCTOR assigned/unassigned, LAB draft/publish | Cần Huy chạy Clinical/Diagnostic actual API | PENDING OWNER |
| Lease issuer cho phép action ngoài scope | Hưng review IA-010 whitelist; Pharmacy vẫn kiểm capability/ownership | PENDING OWNER |
| Receipt timeout rồi retry | Cùng Idempotency-Key; server không tăng tồn hai lần | web pharmacy.test.tsx + Mongo business |
| Thay body cùng key | 409 | pharmacy-business.test.js/API |
| Held chưa có bằng chứng thanh toán | Không có nút phát; server chặn phát | web + business |
| 409 do version | Reload trạng thái server | UI implementation; browser E2E PENDING |
| Rời màn hình/đổi toa | Abort polling, không cập nhật state cũ | web pharmacy.test.tsx |
| Logout/session đổi | AppRoutes key theo userId; detail/patient view được reset | implementation; browser E2E PENDING |
| Refresh tab/mạng chập chờn qua Gateway | Không suy PAID từ 202; kiểm thêm bằng browser thật | PENDING LIVE |

Không tính mock transport hoặc stub bearer trong test API là bằng chứng Identity live.
API lease test xác minh chữ ký RSA thật; bearer/owner projections giả chỉ dùng trong database test cô lập.
Log bàn giao không chứa token/lease/OTP/nội dung y tế.
