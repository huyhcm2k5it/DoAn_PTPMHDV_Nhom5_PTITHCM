# UMC Care

UMC Care uses nine independently owned services. The first implementation adds MongoDB storage constraints, isolated service credentials, and transaction contract tests for Quan’s three services. HTTP endpoints and the full application runtime are subsequent tasks.

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

## MongoDB foundation tests

The MongoDB test package, dependencies and TypeScript configuration live in [`tests/mongo`](tests/mongo/README.md). Follow its README to install dependencies and run the foundation suite.
