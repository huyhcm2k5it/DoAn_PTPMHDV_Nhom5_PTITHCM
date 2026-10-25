# Phần Huy đã làm và còn chờ bàn giao

Bản ghi lập 25/10/2026 từ source hiện có và [bằng chứng kiểm chứng local](../../tools/huy/VERIFICATION.md). Ghi nhận ở đây nói rõ mức bằng chứng: “có trong repo/đã chạy local” không đồng nghĩa “đã ghép production” hoặc “CI GitHub đã xanh”.

## Đã có trong repository

| Phần | Nội dung quan sát được | Mức trạng thái |
| --- | --- | --- |
| Go services | Module Go 1.27/Echo/pgx; API process, health/readiness, shutdown cho Catalog/Clinical/Diagnostic | Có source. Nền Clinical/Diagnostic chưa có nghiệp vụ visit/LAB |
| Catalog backend | CA-001–006, PostgreSQL migration/seed, giá/idempotency/outbox, JWT/lease, contract OpenAPI | Có source và test local được ghi trong verification |
| Catalog UI | W03 feature React/TypeScript, API adapter/page/form, preview runner riêng | Có source/test/build local được ghi; shell/Gateway thật còn chờ |
| Test Catalog | Domain/API/PostgreSQL thật, race/idempotency/rollback, contract response, web tests | Các kết quả nêu trong verification cho commit tại thời điểm ghi; phải chạy lại trên commit mới |
| Guard kiến trúc | `tools/huy/check_architecture.py` kiểm hướng import Go | Có script; chạy lại khi thêm code |
| CI định nghĩa | `.github/workflows/huy-go.yml` cho Go, test Catalog với Postgres và W03 preview | File cấu hình có; trạng thái chạy trên GitHub chưa được xác nhận trong hồ sơ |
| Compose riêng | `infra/compose/huy.catalog.yml`, Dockerfile và hướng dẫn env/seed | Có file; Docker runtime chưa xác minh trong verification |
| Tài liệu Catalog | README Catalog, W03, lệnh test, auth/payment integration points | Có tài liệu; tên claim/lease và giá/message cần owner xác nhận |
| Quy định GitHub | `docs/QUY_DINH_GITHUB_NHOM5_HUY_QUAN_HUNG_20261024.md` | Có tài liệu; không chứng minh đã cài các quyền/settings bên GitHub |
| Hướng dẫn này | Checklist 18 task và phụ lục CSV 30 operation/message | Có tài liệu bàn giao; không phải bằng chứng code task còn lại đã xong |

## Còn phải Huy hoàn thành

- Clinical: DB/migration nghiệp vụ; auth/projections; CL-001–011; visit, nháp, chỉ định LAB, toa, ký; worker và events.
- Diagnostic: DB/migration nghiệp vụ; command CreateLabOrder; charge/payment proof; DI-002–013; sample/result/review/publish/cancel và settlement fence. DI-001 vẫn chỉ adapter phục hồi tắt mặc định.
- Catalog: publisher/consumer projection và cache theo baseline; ghép auth/lease với Identity live, Envoy, shell/shared transport; consumer giá chạy thật.
- Web: W03 ghép vào SPA; W08 hồ sơ đã ký/kết quả công bố; W10 bác sĩ; W12 LAB; kiểm responsive/keyboard/permission bằng app chạy thật.
- Tích hợp: queue/visit/toa với Quân; Billing/auth/Android với Hưng; HTTP/message/schema và seed được hai bên chạy lại.
- Việc chung: PostgreSQL init/roles cho hệ tích hợp; CI kiểm contract/messages/Clinical/Diagnostic/web; E2E/performance và ma trận truy vết; tài liệu/bằng chứng/demo/release.

## Chờ đồng đội hoặc môi trường

| Việc cần | Người cung cấp/xác nhận | Bằng chứng mở chặn |
| --- | --- | --- |
| Nguồn vé FIRST/RETURN, doctor/patient mapping, expectedTicketVersion và QueueTicketClaimed | Quân | Payload/schema, seed và claim test của Appointment |
| Owner/route web shell và shared UI/feature registry | Quân | Route/interface để export W03/W08/W10/W12, test shell |
| JWT issuer/audience/key/lease claims và luồng revoke/projection | Hưng | Contract Identity đã duyệt, key demo giả, test token/lease thật |
| Billing command/event, LAB charge, settlement fence, refundStatus/cancellationId | Hưng | Schema, queue binding, seed, status/poll và test retry/UNKNOWN |
| PostgreSQL/Compose/RabbitMQ chung | Quân/Huy/Hưng theo owner config | Compose tích hợp dựng sạch và health của từng thành phần |
| Browser/CI/Docker toàn nhóm | Cả nhóm / môi trường | Link CI, output Docker run, E2E qua Gateway |

Huy tiếp tục làm phần độc lập, ghi blocker ở task liên quan và không tự quyết schema mâu thuẫn. Chi tiết bước/test nằm trong [hướng dẫn phần Huy](../HUY_HUONG_DAN_HOAN_THANH_TOAN_BO_TASK.md).

## Các điểm hợp đồng cần đóng

1. **refundStatus:** DI-012 trả trường này nhưng hướng event hiện có chưa xác định đầy đủ projection bên Diagnostic. Hưng/Billing cần chốt nguồn, trạng thái/version/asOf và mapping order/charge/refund.
2. **LAB REJECTED/FAILED:** timeout là pending; request rejected không tự coi là đã xử lý. Nhóm phải thống nhất resubmit idempotent hoặc bác sĩ giải quyết/hủy ý định có audit trước khi ký.
3. **Claim queue:** CL-002 nhận ticket/doctor/version, command cần patientId và nguồn ticket xác thực. Quân chốt projection/API/message hiện hữu; patientId không lấy từ request chưa xác thực.
4. **DI-001:** mặc định tắt và không mở Gateway; cần chốt cách adapter phục hồi dùng cùng requestId/hash/handler và audit.
5. **DI-013:** bảng quyền ghi PATIENT/DOCTOR nhưng câu mô tả có đoạn ghi STAFF. Chốt lại trước khi cấp quyền.
6. **Hoàn tiền và medication hold:** đồng bộ cancellationId/refundStatus/terminal DISPENSED giữa SRS, ERD, API, Billing, Pharmacy và test.
