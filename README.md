# UMC Care

UMC Care uses nine independently owned services. Quân’s Patient, Appointment and Pharmacy services use Node.js, Express, Mongoose and JavaScript CommonJS. The quan branch now includes Pharmacy PH-001..008, its web workspace, transactional stock/settlement workflows and integration tooling.

## GitHub workflow

Đọc [Quy định GitHub và phân quyền thư mục của Huy, Quân, Hưng](docs/QUY_DINH_GITHUB_NHOM5_HUY_QUAN_HUNG_20261024.md) trước khi sửa file chung hoặc đưa code vào `develop`. Tài liệu phân công người review/merge, owner từng thư mục và cách xử lý conflict; checklist thiết lập trên GitHub được theo dõi riêng trong tài liệu.

## Structure and ownership

- apps/web: React + TypeScript web application.
- apps/android: Kotlin + Jetpack Compose; Hưng owns Android PATIENT.
- services: nine services; Quân owns Patient, Appointment and Pharmacy.
- contracts: HTTP and message contracts.
- infra/compose: local Docker Compose configuration.
- envoy, rabbitmq, mongo, postgres: gateway and data infrastructure.
- tests: contract and integration tests.
- docs: project source documentation.

Each service owns its database. Patient, Appointment and Pharmacy use separate Mongo databases and credentials. Their containers are private to the Compose network. Envoy routes, JWT/JWKS and shared Compose are configured; actual Identity/Billing interoperability and nine-service acceptance remain pending owner verification.

## Mongo storage and HTTP tests

The isolated Mongo test package is in tests/mongo. It starts temporary replica sets for storage, HTTP/schema, booking, Pharmacy, concurrency, rollback and recovery checks. Each Node service has its own package and lockfile. Install dependencies with npm ci in services/patient, services/appointment, services/pharmacy, tests/mongo and apps/web, then run:

```powershell
powershell -File tools/quan/verify-local.ps1
```

Setup/migration/seed instructions: [shared Compose README](infra/compose/README.md).
Current implementation and unresolved receiver gates: [Quân week 4 handoff](docs/ban-giao-umc-care/quan-week4-pharmacy.md), [week 5 release preparation](docs/ban-giao-umc-care/quan-week5-release.md), [24-task tracker](docs/ban-giao-umc-care/quan-week4-5-status.csv).
Local tests passing does not mean live E2E, remote CI, Android or release acceptance has completed.
