const fs = require('node:fs');
const path = require('node:path');
const { routes } = require('../../services/pharmacy/src/workers/amqp-runtime');
const definitions = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../rabbitmq/definitions.json'), 'utf8'),
);
for (const name of ['evt.pharmacy.v1', 'cmd.pharmacy.v1', 'dlq.pharmacy.v1']) {
  const queue = definitions.queues.find((q) => q.name === name && q.vhost === '/umc-care');
  if (!queue?.durable || queue.arguments?.['x-queue-type'] !== 'quorum')
    throw new Error('Quorum queue missing: ' + name);
}
for (const [exchange, key] of routes) {
  const queue = exchange.startsWith('umc.commands.') ? 'cmd.pharmacy.v1' : 'evt.pharmacy.v1';
  if (
    !definitions.bindings.some(
      (b) => b.source === exchange && b.routing_key === key && b.destination === queue,
    )
  )
    throw new Error('Receiver binding missing: ' + key);
}
console.log(
  'Pharmacy topology matches worker routes. Broker ACL and receiver behavior require live verification.',
);
