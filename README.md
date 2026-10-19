# UMC Care

Repository scaffold based on the agreed structure, before implementation begins. Each directory has a short README describing its purpose, owner, and scope.

## Structure and ownership

- `apps/web/`: React + TypeScript. Quan owns the shell, routes, and shared UI; feature ownership follows the corresponding service.
- `apps/android/`: Kotlin + Jetpack Compose; Hung owns Android PATIENT.
- `services/`: Nine independent services: Quan - Patient, Appointment, Pharmacy; Huy - Catalog, Clinical, Diagnostic; Hung - Identity, Billing, Notification.
- `contracts/`: HTTP and message contracts.
- `infra/`: Compose, Envoy, RabbitMQ, MongoDB, and PostgreSQL.
- `tests/`: E2E and performance tests.
- `docs/`: Project documentation.
- `.github/workflows/`: CI.

Each service owns its database, migrations, tests, and workers. A service must not access another service's database directly. Add or change files only within the appropriate owner's scope, and update the README if that scope changes.
