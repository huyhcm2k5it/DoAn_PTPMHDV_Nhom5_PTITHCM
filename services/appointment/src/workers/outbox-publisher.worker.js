const { randomUUID } = require('node:crypto');
const { getOutboxModel } = require('../models/appointment.model.js');

function routingKeyFor(message) {
  if (message.message_type === 'RequestCharge') return 'billing.request-charge.v1';
  if (message.message_type === 'AppointmentChanged') return 'appointment.appointment-changed.v1';
  return null;
}
function exchangeFor(message, commandExchange, eventExchange) {
  if (message.message_kind === 'COMMAND') return commandExchange;
  if (message.message_kind === 'EVENT') return eventExchange;
  return null;
}
async function publishOutboxBatch({
  connection,
  channel,
  exchange,
  commandExchange = 'umc.commands.appointment.v1',
  eventExchange = 'umc.events.appointment.v1',
  limit = 100,
  now = new Date(),
  workerId = randomUUID(),
}) {
  if (!channel || typeof channel.publish !== 'function')
    throw new Error('RabbitMQ confirm channel is required.');
  const Outbox = getOutboxModel(connection);
  const records = await Outbox.find({ published_at: null })
    .sort({ occurred_at: 1 })
    .limit(limit)
    .lean();
  let published = 0;
  for (const record of records) {
    const routingKey = routingKeyFor(record);
    if (!routingKey) continue;
    const destinationExchange = exchange || exchangeFor(record, commandExchange, eventExchange);
    if (!destinationExchange) continue;
    await channel.assertExchange(destinationExchange, 'topic', { durable: true });
    const body = Buffer.from(
      JSON.stringify({
        messageId: record.message_id,
        messageKind: record.message_kind,
        messageType: record.message_type,
        schemaVersion: record.schema_version,
        producer: record.producer,
        aggregateId: record.aggregate_id,
        aggregateVersion: record.aggregate_version,
        correlationId: record.correlation_id,
        occurredAt: record.occurred_at,
        payload: record.payload,
      }),
    );
    let returned = false;
    const onReturn = (message) => {
      if (message?.properties?.messageId === record.message_id) returned = true;
    };
    channel.on?.('return', onReturn);
    try {
      channel.publish(destinationExchange, routingKey, body, {
        persistent: true,
        mandatory: true,
        messageId: record.message_id,
        type: record.message_type,
        headers: { workerId },
      });
      if (channel.waitForConfirms) await channel.waitForConfirms();
      if (returned) throw new Error('OUTBOX_UNROUTABLE');
    } finally {
      if (channel.off) channel.off('return', onReturn);
      else if (channel.removeListener) channel.removeListener('return', onReturn);
    }
    const result = await Outbox.updateOne(
      { message_id: record.message_id, published_at: null },
      { $set: { published_at: now }, $inc: { attempts: 1 } },
    );
    published += result.modifiedCount;
  }
  return published;
}
module.exports = { publishOutboxBatch, routingKeyFor, exchangeFor };
