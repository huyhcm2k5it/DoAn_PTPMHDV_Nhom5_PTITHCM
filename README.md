# UMC Care

UMC Care là đồ án 9 microservice. Mỗi service sở hữu database, migration, API và worker của mình. Các thao tác liên service dùng RabbitMQ và local projection; Envoy là cổng HTTP chung cho web và Android.

| Người phụ trách | Service | Công nghệ |
| --- | --- | --- |
| Huy | Catalog, Clinical, Diagnostic | Go, PostgreSQL; Catalog dùng Redis cache |
| Quân | Patient, Appointment, Pharmacy | Node.js CommonJS, MongoDB |
| Hưng | Identity, Billing, Notification | Django, PostgreSQL |

## GitHub workflow

Đọc [Quy định GitHub và phân quyền thư mục của Huy, Quân, Hưng](docs/QUY_DINH_GITHUB_NHOM5_HUY_QUAN_HUNG_20261024.md) trước khi sửa file chung hoặc đưa code vào `develop`. Tài liệu phân công người review/merge, owner từng thư mục và cách xử lý conflict; checklist thiết lập trên GitHub được theo dõi riêng trong tài liệu.

## Structure and ownership

- apps/web: React + TypeScript web application.
- apps/android: Kotlin + Jetpack Compose; Hưng owns Android PATIENT.
- services: nine services; Quân owns Patient, Appointment and Pharmacy.
- contracts: HTTP and message contracts.
- infra/compose: cấu hình triển khai chung và hướng dẫn chuyển sang dịch vụ dữ liệu online.
- envoy, rabbitmq, mongo, postgres: gateway and data infrastructure.
- tests: contract and integration tests.
- docs: project source documentation.

Mỗi service dùng credential riêng và không đọc database của service khác. Xem [env theo ba owner](env/README.md) và [Compose README](infra/compose/README.md) để chuẩn bị JWT key, database, RabbitMQ và Gateway. Chạy migration trước API; chạy worker riêng để phát outbox/nhận event. Chỉ bật HTTP API không hoàn thành luồng bất đồng bộ.

**Demo giữa ba máy:** dùng cùng các database, Redis và broker online theo [env theo owner](env/README.md). Docker Hub chỉ lưu image, không lưu dữ liệu hoặc RabbitMQ queue. [Compose README](infra/compose/README.md) ghi rõ phần cấu hình hiện còn phải đổi trước khi coi stack là online hoàn chỉnh.

Hợp đồng giao tiếp gồm [9 OpenAPI/86 operation](contracts/http/), [message schema](contracts/messages/) và [baseline manifest](contracts/be-baseline-manifest.json). HTTP `202` nghĩa là yêu cầu đã được nhận; client cần đọc `statusUrl` để biết trạng thái cuối.

## Kiểm tra contract và luồng

Các bài kiểm tra mã và contract nằm trong `tests/` và README của từng service. Để nghiệm thu demo, kiểm trực tiếp trên cùng MongoDB Atlas, PostgreSQL online, Redis online và CloudAMQP đã cấu hình theo ba owner; bài test tách biệt không thay bằng chứng này.

Kiểm tra contract tĩnh bằng `python tools/be/check_api_matrix.py` và `python tools/be/check_baseline.py`; kiểm tra một phần topology bằng `python tools/be/test_topology.py`. Lệnh chạy riêng của từng service nằm trong README của service đó. [Bộ test chung](tests/README.md) và [hồ sơ bàn giao](docs/ban-giao-umc-care/README.md) ghi rõ bằng chứng đã có và phần còn chờ.

**Giới hạn hiện tại:** Clinical cần feed ticket trước khi claim từ Appointment; một số API bác sĩ của Clinical/Diagnostic cần projection quyền hiện hành. Contract test, dữ liệu seed hoặc health check không chứng minh hành trình 9 service đã chạy end-to-end.
