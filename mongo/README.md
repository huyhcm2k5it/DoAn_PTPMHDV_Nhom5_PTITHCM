# Mongo

Mongo storage configuration and shared primitives are owned by the team. Node code uses JavaScript/CommonJS and receives an owner-specific Mongoose connection.

For the group demo, Quân provides three MongoDB Atlas URIs selecting `patient_db`, `appointment_db` and `pharmacy_db`. Each service account receives permissions only on its own database. Put the URIs in the ignored `env/quan.env`; the example file contains placeholders. Confirm Atlas network access, TLS and transaction support before running booking or pharmacy flows. The current Compose file still contains Mongo bootstrap dependencies; see [the deployment status](../infra/compose/README.md).

Storage/index bootstraps are in each owner’s services/*/src/db/indexes.js. Transaction helper uses Mongoose connection.transaction; its callback can retry, so external RabbitMQ publication belongs after commit via an outbox.
