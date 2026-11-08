const {
  persistDeliveryFailure,
  drainRetryJobs,
  delays: RETRY_DELAYS_MS,
} = require('../../../../mongo/durable-retry');
const { startBackgroundJobs } = require('../../../../mongo/background-jobs');
const amqplib = require('amqplib');
const { applyAccessProjection } = require('../services/access-projection.service.js');
const { applyCatalogChanged } = require('../services/catalog-projection.service.js');
const {
  handleBillingMessage,
  handleReserveSettlementCommand,
} = require('./billing-events.worker.js');
const {
  handleClinicalMessage,
  handleClaimQueueTicketCommand,
} = require('./clinical-events.worker.js');

const ROUTES = [
  {
    queue: 'cmd.appointment.v1',
    exchange: 'umc.commands.clinical.v1',
    key: 'appointment.claim-queue-ticket.v1',
  },
  {
    queue: 'cmd.appointment.v1',
    exchange: 'umc.commands.billing.v1',
    key: 'appointment.reserve-settlement.v1',
  },
  {
    queue: 'evt.appointment.v1',
    exchange: 'umc.events.billing.v1',
    key: 'billing.charge-prepared.v1',
  },
  {
    queue: 'evt.appointment.v1',
    exchange: 'umc.events.billing.v1',
    key: 'billing.settlement-decision.v1',
  },
  { queue: 'evt.appointment.v1', exchange: 'umc.events.billing.v1', key: 'billing.charge-paid.v1' },
  { queue: 'evt.appointment.v1', exchange: 'umc.events.billing.v1', key: 'billing.billing-status-changed.v1' },
  {
    queue: 'evt.appointment.v1',
    exchange: 'umc.events.clinical.v1',
    key: 'clinical.visit-signed.v1',
  },
  {
    queue: 'evt.appointment.v1',
    exchange: 'umc.events.clinical.v1',
    key: 'clinical.visit-return-ready.v1',
  },
  {
    queue: 'evt.appointment.v1',
    exchange: 'umc.events.identity.v1',
    key: 'identity.identity-access-changed.v1',
  },
  {
    queue: 'evt.appointment.v1',
    exchange: 'umc.events.patient.v1',
    key: 'patient.patient-access-changed.v1',
  },
  {
    queue: 'evt.appointment.v1',
    exchange: 'umc.events.catalog.v1',
    key: 'catalog.catalog-changed.v1',
  },
];

function routeFor(message, routingKey) {
  if (message.messageKind === 'COMMAND' && message.messageType === 'ClaimQueueTicket')
    return 'claim';
  if (message.messageKind === 'COMMAND' && message.messageType === 'ReserveSettlement')
    return 'reserve';
  if (
    ['ChargePrepared', 'SettlementDecision', 'ChargePaid', 'BillingStatusChanged'].includes(
      message.messageType,
    )
  )
    return 'billing';
  if (['VisitSigned', 'VisitReturnReady'].includes(message.messageType)) return 'clinical';
  if (['IdentityAccessChanged', 'PatientAccessChanged'].includes(message.messageType))
    return 'projection';
  if (message.messageType === 'CatalogChanged') return 'catalog';
  throw new Error(
    `Unsupported Appointment message: ${message.messageType || routingKey || 'unknown'}`,
  );
}

async function assertTopology(
  channel,
  { quarantineExchange = 'umc.deadletters.appointment.v1' } = {},
) {
  const exchanges = new Set(ROUTES.map((route) => route.exchange));
  exchanges.add(quarantineExchange);
  for (const exchange of exchanges)
    await channel.assertExchange(exchange, 'topic', { durable: true });
  await channel.assertQueue('dlq.appointment.v1', {
    durable: true,
    arguments: { 'x-queue-type': 'quorum' },
  });
  await channel.bindQueue('dlq.appointment.v1', quarantineExchange, 'appointment.quarantine.v1');
  for (const route of ROUTES) {
    await channel.assertQueue(route.queue, {
      durable: true,
      arguments: { 'x-queue-type': 'quorum' },
    });
    await channel.bindQueue(route.queue, route.exchange, route.key);
  }
}

async function dispatchMessage({ connection, message, exchange, routingKey, now }) {
  const route = ROUTES.find((r) => r.exchange === exchange && r.key === routingKey);
  const producer = exchange?.split('.')[2];
  if (
    !route ||
    message?.producer?.toLowerCase() !== producer ||
    message.schemaVersion !== 1 ||
    message.messageKind !== (exchange.startsWith('umc.commands.') ? 'COMMAND' : 'EVENT')
  )
    throw Object.assign(new Error('Untrusted broker route or producer.'), { status: 400 });
  const kind = routeFor(message, routingKey);
  const expected = {
    'appointment.claim-queue-ticket.v1': 'ClaimQueueTicket',
    'appointment.reserve-settlement.v1': 'ReserveSettlement',
    'billing.charge-prepared.v1': 'ChargePrepared',
    'billing.settlement-decision.v1': 'SettlementDecision',
    'billing.charge-paid.v1': 'ChargePaid',
    'billing.billing-status-changed.v1': 'BillingStatusChanged',
    'clinical.visit-signed.v1': 'VisitSigned',
    'clinical.visit-return-ready.v1': 'VisitReturnReady',
    'identity.identity-access-changed.v1': 'IdentityAccessChanged',
    'patient.patient-access-changed.v1': 'PatientAccessChanged',
    'catalog.catalog-changed.v1': 'CatalogChanged',
  };
  if (message.messageType !== expected[routingKey])
    throw Object.assign(new Error('Message type differs from trusted route.'), { status: 400 });
  const handler = {
    claim: handleClaimQueueTicketCommand,
    reserve: handleReserveSettlementCommand,
    billing: handleBillingMessage,
    clinical: handleClinicalMessage,
    catalog: applyCatalogChanged,
    projection: applyAccessProjection,
  }[kind];
  return handler({ connection, message, now });
}

async function startAppointmentWorker({
  connection,
  amqpUrl = process.env.AMQP_URL || 'amqp://guest:guest@rabbitmq:5672/umc-care',
  prefetch = Number(process.env.AMQP_PREFETCH || 20),
  connect = amqplib.connect,
  now = () => new Date(),
} = {}) {
  if (!connection) throw new Error('Mongo connection is required for Appointment worker.');
  const broker = await connect(amqpUrl);
  const channel = await broker.createConfirmChannel();
  await assertTopology(channel);
  await channel.prefetch(prefetch);
  const consumers = new Map();
  const consume = async (queue) => {
    consumers.set(
      queue,
      await channel.consume(queue, async (message) => {
        if (!message) return;
        try {
          try {
            let envelope;
            try {
              envelope = JSON.parse(message.content.toString('utf8'));
            } catch {
              throw Object.assign(new Error('Invalid JSON.'), { status: 400 });
            }
            await dispatchMessage({
              connection,
              message: envelope,
              exchange: message.fields.exchange,
              routingKey: message.fields.routingKey,
              now: now(),
            });
          } catch (error) {
            await persistDeliveryFailure({
              connection,
              delivery: message,
              error,
              consumerName: 'appointment',
              now: now(),
            });
          }
          channel.ack(message);
        } catch {
          // Without durable DB acceptance, close and leave delivery unacked for redelivery.
          broker.close().catch(() => {});
        }
      }),
    );
  };
  for (const queue of new Set(ROUTES.map((route) => route.queue))) await consume(queue);
  const jobs = startBackgroundJobs({
    intervalMs: 1000,
    jobs: [
      () =>
        drainRetryJobs({
          connection,
          consumerName: 'appointment',
          now: now(),
          dispatch: (message, exchange, routingKey) =>
            dispatchMessage({ connection, message, exchange, routingKey, now: now() }),
        }),
    ],
    onError: (error) => console.error('appointment retry failed:', error.code || error.name),
  });
  const close = async () => {
    await jobs.close();
    await Promise.all(
      [...consumers.values()].map((consumer) => channel.cancel(consumer.consumerTag)),
    );
    await channel.close();
    await broker.close();
  };
  broker.on?.('error', (error) => console.error('appointment worker broker error:', error.message));
  return { broker, channel, close, queues: [...consumers.keys()] };
}

module.exports = {
  ROUTES,
  RETRY_DELAYS_MS,
  assertTopology,
  startAppointmentWorker,
  routeFor,
  dispatchMessage,
};
