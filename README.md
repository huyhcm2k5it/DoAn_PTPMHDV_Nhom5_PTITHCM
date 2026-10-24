# UMC Care

UMC Care uses nine independently owned services. The current local branch adds Mongo storage contracts and Node.js CommonJS scaffolds for Quân’s Patient, Appointment and Pharmacy services.

## Structure and ownership

- apps/web: React + TypeScript web application.
- apps/android: Kotlin + Jetpack Compose; Hưng owns Android PATIENT.
- services: nine services; Quân owns Patient, Appointment and Pharmacy.
- contracts: HTTP and message contracts.
- infra/compose: local Docker Compose configuration.
- envoy, rabbitmq, mongo, postgres: gateway and data infrastructure.
- tests: contract and integration tests.
- docs: project source documentation.

Each service owns its database. Patient, Appointment and Pharmacy use separate Mongo databases and credentials. Their containers are private to the Compose network; Envoy routing and JWT verification are still awaiting the gateway owner’s handoff.

## Mongo storage and HTTP tests

The isolated Mongo test package is in tests/mongo. It starts a temporary authenticated replica set for storage contracts and exercises the Patient read APIs and public AP-004 slot query. Each Node service has its own package, lockfile, syntax check and health test. See the README files beside each package for commands.