const { randomUUID } = require('node:crypto');
const amqplib = require('amqplib');
const { applyAccessProjection } = require('../services/access-projection.service.js');
const { applyCatalogChanged } = require('../services/catalog-projection.service.js');
const { handleBillingMessage, handleReserveSettlementCommand } = require('./billing-events.worker.js');
const { handleClinicalMessage, handleClaimQueueTicketCommand } = require('./clinical-events.worker.js');

const RETRY_DELAYS_MS = [5000, 15000, 60000];

const ROUTES = [
  { queue: 'cmd.appointment.v1', exchange: 'umc.commands.clinical.v1', key: 'appointment.claim-queue-ticket.v1' },
  { queue: 'cmd.appointment.v1', exchange: 'umc.commands.billing.v1', key: 'billing.reserve-settlement.v1' },
  { queue: 'evt.appointment.v1', exchange: 'umc.events.billing.v1', key: 'billing.charge-prepared.v1' },
  { queue: 'evt.appointment.v1', exchange: 'umc.events.billing.v1', key: 'billing.settlement-reserved.v1' },
  { queue: 'evt.appointment.v1', exchange: 'umc.events.billing.v1', key: 'billing.settlement-decision.v1' },
  { queue: 'evt.appointment.v1', exchange: 'umc.events.billing.v1', key: 'billing.charge-paid.v1' },
  { queue: 'evt.appointment.v1', exchange: 'umc.events.clinical.v1', key: 'clinical.visit-signed.v1' },
  { queue: 'evt.appointment.v1', exchange: 'umc.events.clinical.v1', key: 'clinical.visit-return-ready.v1' },
  { queue: 'evt.appointment.access.v1', exchange: 'umc.events.identity.v1', key: 'identity.identity-access-changed.v1' },
  { queue: 'evt.appointment.access.v1', exchange: 'umc.events.patient.v1', key: 'patient.patient-access-changed.v1' },
  { queue: 'evt.appointment.catalog.v1', exchange: 'umc.events.catalog.v1', key: 'catalog.catalog-changed.v1' },
];

function routeFor(message, routingKey) {
  if (message.messageKind === 'COMMAND' && message.messageType === 'ClaimQueueTicket') return 'claim';
  if (message.messageKind === 'COMMAND' && message.messageType === 'ReserveSettlement') return 'reserve';
  if (['ChargePrepared', 'SettlementReserved', 'SettlementDecision', 'ChargePaid'].includes(message.messageType)) return 'billing';
  if (['VisitSigned', 'VisitReturnReady'].includes(message.messageType)) return 'clinical';
  if (['IdentityAccessChanged', 'PatientAccessChanged'].includes(message.messageType)) return 'projection';
  if (message.messageType === 'CatalogChanged') return 'catalog';
  throw new Error(`Unsupported Appointment message: ${message.messageType || routingKey || 'unknown'}`);
}

function routeId(exchange, routingKey) {
  return Buffer.from(`${exchange}:${routingKey}`).toString('base64url').slice(0, 40);
}

async function assertTopology(channel, { quarantineExchange = 'umc.deadletters.appointment.v1' } = {}) {
  const exchanges = new Set(ROUTES.map((route) => route.exchange));
  exchanges.add(quarantineExchange);
  for (const exchange of exchanges) await channel.assertExchange(exchange, 'topic', { durable: true });
  await channel.assertQueue('dlq.appointment.v1', { durable: true });
  await channel.bindQueue('dlq.appointment.v1', quarantineExchange, 'appointment.quarantine.v1');
  for (const route of ROUTES) {
    await channel.assertQueue(route.queue, { durable: true });
    await channel.bindQueue(route.queue, route.exchange, route.key);
  }
}

async function publishQuarantine(channel, message, error, properties, quarantineExchange) {
  const body = Buffer.from(message.content);
  channel.publish(quarantineExchange, 'appointment.quarantine.v1', body, {
    persistent: true,
    contentType: 'application/json',
    messageId: properties.messageId || randomUUID(),
    headers: {
      ...(properties.headers || {}),
      'x-error-code': error.code || error.name || 'WORKER_ERROR',
      'x-error-message': String(error.message || 'worker error').slice(0, 200),
    },
  });
  if (channel.waitForConfirms) await channel.waitForConfirms();
}

async function scheduleRetry(channel, message, error, properties, exchange, routingKey, retryAttempt) {
  const delay = RETRY_DELAYS_MS[retryAttempt];
  if (delay == null) return false;
  const queue = `retry.appointment.${routeId(exchange, routingKey)}.${delay}`;
  await channel.assertQueue(queue, {
    durable: true,
    arguments: {
      'x-message-ttl': delay,
      'x-dead-letter-exchange': exchange,
      'x-dead-letter-routing-key': routingKey,
    },
  });
  channel.sendToQueue(queue, Buffer.from(message.content), {
    persistent: true,
    contentType: properties.contentType || 'application/json',
    messageId: properties.messageId,
    type: properties.type,
    headers: {
      ...(properties.headers || {}),
      'x-retry-count': retryAttempt + 1,
      'x-last-error': String(error.message || 'worker error').slice(0, 200),
    },
  });
  if (channel.waitForConfirms) await channel.waitForConfirms();
  return true;
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
    consumers.set(queue, await channel.consume(queue, async (message) => {
      if (!message) return;
      const properties = message.properties || {};
      const retryAttempt = Number(properties.headers?.['x-retry-count'] || 0);
      try {
        const envelope = JSON.parse(message.content.toString('utf8'));
        const kind = routeFor(envelope, message.fields.routingKey);
        if (kind === 'claim') await handleClaimQueueTicketCommand({ connection, message: envelope, now: now() });
        else if (kind === 'reserve') await handleReserveSettlementCommand({ connection, message: envelope, now: now() });
        else if (kind === 'billing') await handleBillingMessage({ connection, message: envelope, now: now() });
        else if (kind === 'clinical') await handleClinicalMessage({ connection, message: envelope, now: now() });
        else if (kind === 'catalog') await applyCatalogChanged({ connection, message: envelope, now: now() });
        else await applyAccessProjection({ connection, message: envelope, now: now() });
        channel.ack(message);
      } catch (error) {
        const exchange = message.fields.exchange;
        const routingKey = message.fields.routingKey;
        const retryable = !Number.isInteger(error?.status) || error.status >= 500;
        const retried = exchange && routingKey && retryable
          ? await scheduleRetry(channel, message, error, properties, exchange, routingKey, retryAttempt)
          : false;
        if (!retried) await publishQuarantine(channel, message, error, properties, 'umc.deadletters.appointment.v1');
        channel.ack(message);
      }
    }));
  };
  for (const queue of new Set(ROUTES.map((route) => route.queue))) await consume(queue);
  const close = async () => {
    await Promise.all([...consumers.values()].map((consumer) => channel.cancel(consumer.consumerTag)));
    await channel.close();
    await broker.close();
  };
  broker.on?.('error', (error) => console.error('appointment worker broker error:', error.message));
  return { broker, channel, close, queues: [...consumers.keys()] };
}

module.exports = { ROUTES, RETRY_DELAYS_MS, assertTopology, startAppointmentWorker, routeFor };
