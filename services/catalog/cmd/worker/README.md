# worker

# Catalog stream worker

The worker runs the Catalog bootstrap once, emits a durable snapshot stream and 10-second checkpoints, publishes pending outbox rows with mandatory routing and publisher confirms, and projects `IdentityAccessChanged` with monotonic source-version checks.

Required environment: `DATABASE_URL`, `AMQP_URL`. Set `CATALOG_DECLARE_TOPOLOGY=true` only for the isolated Huy development broker where creating Catalog's exchange/queue is permitted. It binds `evt.catalog.v1` to the Identity-owned exchange and does not declare that foreign exchange.

Build/run from `services/catalog`:

```powershell
go build ./cmd/worker
$env:DATABASE_URL='postgres://...'
$env:AMQP_URL='amqp://...'
go run ./cmd/worker
```

The worker uses persistent deliveries and does not mark an outbox event SENT until RabbitMQ confirms it and the mandatory publish has no return. A crash after confirmation can repeat a message; consumers must deduplicate by `messageId`.
