# UMC Care

Repository scaffold based on the agreed structure, before implementation begins. Each directory has a short README describing its purpose, owner, and scope.

## GitHub workflow

Đọc [Quy định GitHub và phân quyền thư mục của Huy, Quân, Hưng](docs/QUY_DINH_GITHUB_NHOM5_HUY_QUAN_HUNG_20261024.md) trước khi sửa file chung hoặc đưa code vào `develop`. Tài liệu phân công người review/merge, owner từng thư mục và cách xử lý conflict; checklist thiết lập trên GitHub được theo dõi riêng trong tài liệu.

## Structure and ownership

- `apps/web/`: React + TypeScript. Quan owns the shell, routes, and shared UI; feature ownership follows the corresponding service.
- `apps/android/`: Kotlin + Jetpack Compose; Hung owns Android PATIENT.
- `services/`: Nine independent services: Quan - Patient, Appointment, Pharmacy; Huy - Catalog, Clinical, Diagnostic; Hung - Identity, Billing, Notification.
- `contracts/`: HTTP and message contracts.
- `infra/compose/`: Docker Compose configuration.
- `envoy/`, `rabbitmq/`, `mongo/`, `postgres/`: Root-level configuration for the gateway and data services, as shown in the directory diagram.
- `tests/`: E2E and performance tests.
- `docs/`: Project documentation.
- `.github/workflows/`: CI.

Each service owns its database, migrations, tests, and workers. A service must not access another service's database directly. Add or change files only within the appropriate owner's scope, and update the README if that scope changes.
