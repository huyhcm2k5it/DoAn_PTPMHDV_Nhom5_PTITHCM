# Mongo and API contract tests

This JavaScript/CommonJS package verifies owner storage, Mongo transactions, API authorization, booking, settlement, pharmacy and durable delivery behavior using temporary one-member MongoDB replica sets.

Install the Patient, Appointment and Pharmacy service dependencies before running this package; tests import their real application modules. CI installs each service separately so dependencies resolve from the service that uses them.

From this directory:

```sh
npm ci --ignore-scripts
npm run check
npm test
```

Tests require Node.js 24.x and download/cache MongoDB 8.0.16. The normal `*.test.js` suite does not require Docker, Atlas or a shared RabbitMQ broker. It does not reset application databases.

Two additional files exercise a real RabbitMQ broker:

- `pharmacy-broker.integration.js`: replay after consumer restart, duplicate suppression and quarantine.
- `patient-broker.integration.js`: Identity onboarding, profile creation, persisted events after consumer restart, permission revocation and quarantine.

Run each with `node --test --test-concurrency=1 <file>` and `TEST_AMQP_URL` selecting its own isolated `quan-ci-*` vhost. Never use the shared application vhost. Separate vhosts prevent one test's intentionally invalid event from entering another test's DLQ; sequential processes avoid contention while downloading the MongoDB binary.

`patient-identity-projection.test.js`, `pharmacy-identity-onboarding.test.js` and the worker recovery suites under the Django services cover the integration failures fixed in November 2026. CI also runs the actual service unit tests and formatting checks. Passing these suites does not replace live nine-service business journey verification.
