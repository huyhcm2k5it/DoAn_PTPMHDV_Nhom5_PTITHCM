const { createHash } = require('node:crypto');
const {
  applyAccessProjection,
} = require('../services/access-projection.service');
const {
  applyPrescriptionFinalized,
} = require('../services/prescription-projection.service');
const { applyCatalogChanged } = require('../../../../mongo/catalog-projection');
const { handleBillingMessage } = require('../services/settlement.service');
const routes = [
  [
    'umc.events.clinical.v1',
    'clinical.prescription-finalized.v1',
    'clinical',
    'PrescriptionFinalized',
    'EVENT',
    applyPrescriptionFinalized,
  ],
  [
    'umc.events.catalog.v1',
    'catalog.catalog-changed.v1',
    'catalog',
    'CatalogChanged',
    'EVENT',
    applyCatalogChanged,
  ],
  [
    'umc.events.patient.v1',
    'patient.patient-access-changed.v1',
    'patient',
    'PatientAccessChanged',
    'EVENT',
    applyAccessProjection,
  ],
  [
    'umc.events.identity.v1',
    'identity.identity-access-changed.v1',
    'identity',
    'IdentityAccessChanged',
    'EVENT',
    applyAccessProjection,
  ],
  [
    'umc.commands.billing.v1',
    'pharmacy.reserve-settlement.v1',
    'billing',
    'ReserveSettlement',
    'COMMAND',
    handleBillingMessage,
  ],
  ...[
    'ChargePrepared',
    'ChargePaid',
    'SettlementDecision',
    'BillingStatusChanged',
  ].map((type) => [
    'umc.events.billing.v1',
    'billing.' +
      type.replace(/[A-Z]/g, (m, i) => (i ? '-' : '') + m.toLowerCase()) +
      '.v1',
    'billing',
    type,
    'EVENT',
    handleBillingMessage,
  ]),
];
const retryId = (exchange, key) =>
  createHash('sha256')
    .update(exchange + ':' + key)
    .digest('hex')
    .slice(0, 20);
async function dispatchMessage({
  connection,
  message,
  exchange,
  routingKey,
  now,
}) {
  const route = routes.find(
    (r) =>
      r[0] === exchange && r[1] === routingKey && r[3] === message?.messageType,
  );
  if (!route)
    throw Object.assign(new Error('Untrusted broker route.'), { status: 400 });
  if (
    message.producer?.toLowerCase() !== route[2] ||
    message.messageKind !== route[4] ||
    message.schemaVersion !== 1
  )
    throw Object.assign(new Error('Untrusted producer or envelope.'), {
      status: 400,
    });
  return route[5]({
    connection,
    message,
    now,
    consumerName: 'pharmacy-catalog',
  });
}
async function startPharmacyWorker({
  connection,
  connect,
  amqpUrl,
  now = () => new Date(),
}) {
  if (!amqpUrl) throw new Error('AMQP_URL is required.');
  const {
    persistDeliveryFailure,
    drainRetryJobs,
  } = require('../../../../mongo/durable-retry');
  const { startBackgroundJobs } = require('../../../../mongo/background-jobs');
  const broker = await connect(amqpUrl),
    channel = await broker.createConfirmChannel();
  const queues = ['evt.pharmacy.v1', 'cmd.pharmacy.v1'];
  for (const queue of [...queues, 'dlq.pharmacy.v1'])
    await channel.assertQueue(queue, {
      durable: true,
      arguments: { 'x-queue-type': 'quorum' },
    });
  await channel.assertExchange('umc.deadletters.pharmacy.v1', 'topic', {
    durable: true,
  });
  await channel.bindQueue(
    'dlq.pharmacy.v1',
    'umc.deadletters.pharmacy.v1',
    'pharmacy.quarantine.v1',
  );
  for (const [exchange, key] of routes) {
    await channel.assertExchange(exchange, 'topic', { durable: true });
    await channel.bindQueue(
      exchange.startsWith('umc.commands.') ? queues[1] : queues[0],
      exchange,
      key,
    );
  }
  await channel.prefetch(10);
  const dispatch = (message, exchange, routingKey) =>
    dispatchMessage({ connection, message, exchange, routingKey, now: now() });
  const callback = async (delivery) => {
    if (!delivery) return;
    try {
      try {
        let message;
        try {
          message = JSON.parse(delivery.content.toString('utf8'));
        } catch {
          throw Object.assign(new Error('Invalid JSON'), {
            status: 400,
            code: 'INVALID_MESSAGE',
          });
        }
        await dispatch(
          message,
          delivery.fields.exchange,
          delivery.fields.routingKey,
        );
      } catch (error) {
        await persistDeliveryFailure({
          connection,
          delivery,
          error,
          consumerName: 'pharmacy',
          now: now(),
        });
      }
      channel.ack(delivery);
    } catch {
      // DB failure prevented durable acceptance; broker returns unacked deliveries on close.
      broker.close().catch(() => {});
    }
  };
  const consumers = [];
  for (const queue of queues)
    consumers.push(await channel.consume(queue, callback));
  const jobs = startBackgroundJobs({
    intervalMs: 1000,
    jobs: [
      () =>
        drainRetryJobs({
          connection,
          consumerName: 'pharmacy',
          dispatch,
          now: now(),
        }),
    ],
    onError: (error) =>
      console.error('pharmacy retry failed:', error.code || error.name),
  });
  return {
    broker,
    channel,
    async close() {
      await jobs.close();
      try {
        for (const consumer of consumers)
          await channel.cancel(consumer.consumerTag);
        await channel.close();
      } finally {
        await broker.close();
      }
    },
  };
}
module.exports = { routes, retryId, dispatchMessage, startPharmacyWorker };
