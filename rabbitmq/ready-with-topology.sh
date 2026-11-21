#!/bin/sh
set -eu

definitions=/etc/umc-rabbitmq/definitions.json
marker=/tmp/umc-topology-imported

rabbitmq-diagnostics -q ping
rabbitmq-diagnostics -q check_port_connectivity
checksum=$(sha256sum "$definitions" | cut -d ' ' -f 1)
if [ ! -r "$marker" ] || [ "$(cat "$marker")" != "$checksum" ]; then
  rabbitmqctl -q import_definitions "$definitions"
  printf '%s\n' "$checksum" > "$marker"
fi
