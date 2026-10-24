# Local Compose

Run scripts/dev/bootstrap-local.ps1 from the repository root once to create an ignored .env and a local Mongo replica-set keyfile. The script preserves existing files. Then run:

    docker compose --env-file .env -f infra/compose/compose.yaml config --quiet
    docker compose --env-file .env -f infra/compose/compose.yaml up -d --build --wait

MongoDB, RabbitMQ and the three Node services use a private internal network with no host-published ports. MongoDB starts as a one-member replica set and receives three database-scoped readWrite users. RabbitMQ is health-checked but owner-specific application users/permissions are pending the agreed message topology. Envoy is not included until its owner supplies the gateway configuration.

To stop containers while preserving data, run docker compose --env-file .env -f infra/compose/compose.yaml down. Persistent volumes remain. Do not remove volumes unless the local demo data can be discarded.