const { randomUUID } = require('node:crypto');

async function publishPatientOutboxBatch({
  connection,
  channel,
  exchange = 'umc.events.patient.v1',
  routingKey = 'patient.patient-access-changed.v1',
  limit = 100,
  now = new Date(),
  workerId = randomUUID(),
}) {
  if (!channel || typeof channel.publish !== 'function') throw new Error('RabbitMQ confirm channel is required.');
  const records = await connection.collection('outbox').find({ message_type: 'PatientAccessChanged', published_at: null, $and: [{ $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }] }], $or: [{ claim_lease_until: null }, { claim_lease_until: { $lte: now } }] }).sort({ occurred_at: 1 }).limit(limit).toArray();
  await channel.assertExchange(exchange, 'topic', { durable: true });
  let published = 0;
  for (const record of records) {
    const leaseUntil = new Date(now.getTime() + 30 * 1000);
    const claimed = await connection.collection('outbox').updateOne({ message_id: record.message_id, published_at: null, $or: [{ claim_lease_until: null }, { claim_lease_until: { $lte: now } }] }, { $set: { claim_worker_id: workerId, claim_lease_until: leaseUntil } });
    if (!claimed.modifiedCount) continue;
    const body = Buffer.from(JSON.stringify({
      messageId: record.message_id,
      messageKind: record.message_kind,
      messageType: record.message_type,
      schemaVersion: record.schema_version,
      producer: 'patient',
      aggregateId: record.aggregate_id,
      aggregateVersion: record.aggregate_version,
      correlationId: record.correlation_id,
      requestId: record.request_id || record.payload?.requestId || record.message_id,
      causationId: record.causation_id || record.request_id || record.message_id,
      occurredAt: record.occurred_at,
      payload: record.payload,
    }));
    let returned = false;
    const onReturn = (message) => { if (message?.properties?.messageId === record.message_id) returned = true; };
    channel.on?.('return', onReturn);
    try {
      channel.publish(exchange, routingKey, body, { persistent: true, mandatory: true, messageId: record.message_id, type: record.message_type, headers: { workerId } });
      if (channel.waitForConfirms) await channel.waitForConfirms();
      if (returned) throw new Error('OUTBOX_UNROUTABLE');
    } catch (error) {
      await connection.collection('outbox').updateOne({ message_id: record.message_id, claim_worker_id: workerId, published_at: null }, { $set: { claim_worker_id: null, claim_lease_until: null, next_attempt_at: new Date(now.getTime() + 5000) }, $inc: { attempts: 1 } });
      throw error;
    } finally {
      channel.off?.('return', onReturn);
      channel.removeListener?.('return', onReturn);
    }
    const update = await connection.collection('outbox').updateOne({ message_id: record.message_id, claim_worker_id: workerId, published_at: null }, { $set: { published_at: now, claim_worker_id: null, claim_lease_until: null, next_attempt_at: null }, $inc: { attempts: 1 } });
    published += update.modifiedCount;
  }
  return published;
}

module.exports = { publishPatientOutboxBatch };
