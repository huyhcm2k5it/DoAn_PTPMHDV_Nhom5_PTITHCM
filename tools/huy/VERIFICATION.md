# Kiểm chứng phần Huy — 22/11/2026

Checkout hiện tại, nhánh `huy_task`. Báo cáo này phân biệt kết quả chạy thật với các bước chưa nghiệm thu; không thay cho xác nhận triển khai online.

## Đã kiểm qua trên phiên bản đang sửa

| Tầng | Bằng chứng |
| --- | --- |
| Go | Unit test và `go vet ./...` của Catalog, Clinical, Diagnostic PASS. Kiểm hướng import domain/application PASS. |
| PostgreSQL 18 thật | Ba suite integration PASS trên DB test biệt lập. Bao gồm dữ liệu nhóm, migration cũ → mới, đồng thời, quyền bị thu hồi, giá, toa, LAB, hoàn và cache kết quả. DB của từng suite được dọn sau chạy. |
| Message qua hai service | Clinical tạo command LAB thật → Diagnostic xử lý PASS. Diagnostic phát event kết quả công bố thật → Clinical xử lý PASS. Đây là kiểm hợp đồng với outbox và DB thật, chưa phải toàn hành trình qua Gateway. |
| RabbitMQ 4.3.6 thật | Clinical/Diagnostic PASS publisher confirm, mandatory return và retry qua consumer restart với NotBefore/token/body giữ nguyên. Vhost test riêng được xóa sau suite. |
| Redis 7.4 thật | Cả ba service PASS đọc/ghi bằng account riêng và ACL từ chối namespace ngoài owner. Clinical/Diagnostic kiểm TTL; Catalog kiểm đổi generation. |
| HTTP/OpenAPI | Response HTTP thực dùng PostgreSQL/RSA của cả ba service khớp schema OpenAPI; kiểm input lỗi và error envelope PASS. |
| Web | 14 file / 86 test PASS; production build PASS. Test Catalog/Clinical đã chuyển vào runner web chung. |
| Cấu hình local | 23 test Python PASS cho topology, env cách ly, port, DB, Redis namespace, khóa JWT và thứ tự seed/start. |

Log và fixture sinh ra nằm trong `.runtime/`, ngoài Git. Container test middleware dùng `--rm`; volume cache/vhost tạm tự dọn. Không dùng credential online để chạy các suite trên.

## Các thay đổi cần triển khai đồng bộ

- Catalog migration `000005`, Clinical `000008`, Diagnostic `000004` chuyển retry/DLQ sang RabbitMQ qua outbox; bỏ tổng cộng sáu bảng sau khi bảo toàn dữ liệu cần chuyển.
- Diagnostic replay chuyển vào `idempotency_records`; ràng buộc unique trên barcode thay registry phụ.
- Redis phục vụ read cache của cả ba API. DB vẫn quyết định quyền, trạng thái và dữ liệu nghiệp vụ; Redis lỗi thì đọc DB.
- API Huy trong Compose tự migrate trước readiness. Worker chờ API healthy. Không còn service `*-migrate` riêng; migrate là lệnh bên trong image API và được chạy trước readiness.
- Đã bỏ preview/Compose/launcher và runner PostgreSQL trùng. Giữ test hồi quy có giá trị trong service/web hiện dùng.
- Mỗi service Node có build context riêng; adapter Mongo là named context dùng chung. Không quét cả checkout/cache. Mỗi context chặn dependency, env và PEM; Dockerfile từng service vẫn được giữ.

## Kết quả chạy project thật của nhóm

- Một Compose duy nhất: 9 API, 9 worker nghiệp vụ, Gateway và web, dùng ba env hiện có. Không còn hạ tầng hoặc migrate container riêng.
- Toàn bộ stack đã khởi động bằng `python tools/be/run.py`. 9 API, Gateway và web healthy; các worker đang chạy.
- Đăng nhập PATIENT, DOCTOR và STAFF qua địa chỉ web đều 200, nhận JWT thật; session và API bảo vệ của từng vai trò đều 200.
- Web → Nginx → Gateway → Catalog trả 200 với 9 khoa thật. Đã sửa HTTP/1.0 upstream khiến proxy trả 426.
- Redis online dùng chung PING trả PONG. RabbitMQ online có consumer Clinical/Diagnostic/command/retry; Clinical queue đã rỗng ở thời điểm kiểm.
- Neon đã áp migration Catalog 5, Clinical 8, Diagnostic 4: tổng 43 bảng. 24 inbox retry cũ thiếu pending job đã được giữ dấu vết trong outbox DLQ, không tự dựng lại payload đã mất.
- Diagnostic còn backlog lịch sử cần xử lý. Sau khi giới hạn handler retry chạy tuần tự và thu hẹp reconcile, lượt theo dõi mới thấy worker nhận CatalogChanged/VisitDoctorGrantChanged liên tục, không còn timeout trong đoạn log cuối hơn hai phút. Cần tiếp tục theo dõi đến khi backlog đồng bộ xong.
- Clinical medical-records và Diagnostic published-results qua web với JWT + lease thật đều đã trả 200 sau bản sửa worker. Hồ sơ Clinical được thử chưa có bản ghi; chưa được đánh dấu nghiệm thu trọn ca LAB.
- Chưa nghiệm thu trọn hành trình đặt lịch → thanh toán → LAB → cấp thuốc. Health và login thành công không thay cho kết quả đó.
- Đã đồng bộ `develop` tại `c345c99` vào `huy_task` rồi đẩy lên GitHub. Sau merge: unit test và go vet ba service PASS; 23 test Python, 86 test web, typecheck/production build, kiểm kiến trúc và ba OpenAPI PASS. Kết quả chạy thật ở trên thuộc lượt kiểm trước merge; chưa chạy lại toàn hành trình nhóm sau merge.
- Compose chỉ chạy 9 API, 9 worker, Gateway và web. Cả 9 DB, RabbitMQ, Redis lấy host online từ ba env nhóm; thiếu cấu hình RabbitMQ online thì dừng, không fallback local.

## Chạy đúng project nhóm

Xem [hướng dẫn Docker](../../infra/compose/README.md). Dùng đúng `env/quan.env`, `env/huy.env`, `env/hung.env`; không chạy launcher test riêng để thay môi trường của nhóm. Không seed/reset dữ liệu online khi khởi động. Web Docker: http://127.0.0.1:15173; Gateway dùng GATEWAY_HOST_PORT của Quân.
