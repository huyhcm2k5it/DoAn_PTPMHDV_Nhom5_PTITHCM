const {
  applyIdentityAccessChanged,
} = require('../services/identity-projection.service');
const {
  persistDeliveryFailure,
  drainRetryJobs,
} = require('../../../../mongo/durable-retry');
const { startBackgroundJobs } = require('../../../../mongo/background-jobs');
const { ApiError } = require('../core/errors');
const exchange = 'umc.events.identity.v1';
const routingKey = 'identity.identity-access-changed.v1';
async function dispatchMessage(input) {
  if (input.exchange !== exchange || input.routingKey !== routingKey) {
    throw new ApiError(
      400,
      'INVALID_MESSAGE',
      'Untrusted Patient broker route.',
    );
  }
  return applyIdentityAccessChanged(input);
}
async function startPatientWorker({
  connection,
  connect,
  amqpUrl,
  now = () => new Date(),
}) {
  if (!connection || !amqpUrl || typeof connect !== 'function')
    throw new Error(
      'Patient worker requires Mongo, AMQP_URL and broker connector.',
    );
  const broker = await connect(amqpUrl);
  broker.on?.('error', (error) =>
    console.error('patient broker error:', error.code || error.name),
  );
  let channel,
    jobs,
    consumer,
    closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await jobs?.close();
    try {
      if (consumer) await channel.cancel(consumer.consumerTag);
      await channel?.close();
    } finally {
      await broker.close();
    }
  }
  try {
    channel = await broker.createConfirmChannel();
    for (const name of [
      exchange,
      'umc.events.patient.v1',
      'umc.deadletters.patient.v1',
    ])
      await channel.assertExchange(name, 'topic', { durable: true });
    for (const queue of ['evt.patient.v1', 'dlq.patient.v1'])
      await channel.assertQueue(queue, {
        durable: true,
        arguments: { 'x-queue-type': 'quorum' },
      });
    await channel.bindQueue('evt.patient.v1', exchange, routingKey);
    await channel.bindQueue(
      'dlq.patient.v1',
      'umc.deadletters.patient.v1',
      'patient.quarantine.v1',
    );
    await channel.prefetch(10);
    const dispatch = (message, source, key) =>
      dispatchMessage({
        connection,
        message,
        exchange: source,
        routingKey: key,
        now: now(),
      });
    consumer = await channel.consume('evt.patient.v1', async (delivery) => {
      if (!delivery) {
        if (!closing) await broker.close().catch(() => {});
        return;
      }
      try {
        try {
          let message;
          try {
            message = JSON.parse(delivery.content.toString('utf8'));
          } catch {
            throw new ApiError(400, 'INVALID_MESSAGE', 'Invalid JSON.');
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
            consumerName: 'patient',
            now: now(),
          });
        }
        channel.ack(delivery);
      } catch {
        // Leave delivery unacked if neither projection nor durable failure storage committed.
        broker.close().catch(() => {});
      }
    });
    jobs = startBackgroundJobs({
      intervalMs: 1000,
      jobs: [
        () =>
          drainRetryJobs({
            connection,
            consumerName: 'patient',
            dispatch,
            now: now(),
          }),
      ],
      onError: (error) =>
        console.error('patient retry failed:', error.code || error.name),
    });
    return { broker, channel, close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
module.exports = { dispatchMessage, startPatientWorker };
