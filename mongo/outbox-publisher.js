const { randomUUID } = require('node:crypto');
async function publishOutbox({ connection, channel, destination, now = new Date(), limit = 100 }) {
  if (typeof channel?.waitForConfirms !== 'function') throw new Error('Confirm channel required.');
  const coll = connection.collection('outbox');
  const due = {
    published_at: null,
    $and: [
      { $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }] },
      { $or: [{ claim_lease_until: null }, { claim_lease_until: { $lte: now } }] },
    ],
  };
  const rows = await coll.find(due).sort({ occurred_at: 1 }).limit(limit).toArray();
  let count = 0;
  for (const row of rows) {
    const target = destination(row);
    if (!target) throw new Error('OUTBOX_UNKNOWN_DESTINATION:' + row.message_type);
    const workerId = randomUUID();
    const claim = await coll.updateOne(
      { ...due, message_id: row.message_id },
      { $set: { claim_worker_id: workerId, claim_lease_until: new Date(now.getTime() + 30000) } },
    );
    if (!claim.modifiedCount) continue;
    const owns = { message_id: row.message_id, published_at: null, claim_worker_id: workerId };
    let returned = false;
    const onReturn = (m) => {
      if (m.properties.messageId === (row.original_message_id || row.message_id)) returned = true;
    };
    channel.on('return', onReturn);
    try {
      await channel.assertExchange(target.exchange, 'topic', { durable: true });
      const body = {
        messageId: row.message_id,
        messageKind: row.message_kind,
        messageType: row.message_type,
        schemaVersion: row.schema_version,
        producer: row.producer,
        aggregateId: row.aggregate_id,
        aggregateVersion: row.aggregate_version,
        correlationId: row.correlation_id,
        requestId: row.request_id || row.message_id,
        causationId: row.causation_id || row.message_id,
        occurredAt: row.occurred_at,
        payload: row.payload,
      };
      channel.publish(
        target.exchange,
        target.key,
        row.delivery_content
          ? Buffer.from(row.delivery_content)
          : Buffer.from(JSON.stringify(body)),
        {
          persistent: true,
          mandatory: true,
          messageId: row.original_message_id || row.message_id,
          type: row.message_type,
          contentType: 'application/json',
        },
      );
      await channel.waitForConfirms();
      if (returned) throw new Error('OUTBOX_UNROUTABLE');
      const saved = await coll.updateOne(owns, {
        $set: {
          published_at: now,
          claim_worker_id: null,
          claim_lease_until: null,
          next_attempt_at: null,
        },
        $inc: { attempts: 1 },
      });
      count += saved.modifiedCount;
    } catch (error) {
      await coll.updateOne(owns, {
        $set: {
          claim_worker_id: null,
          claim_lease_until: null,
          next_attempt_at: new Date(now.getTime() + 5000),
        },
        $inc: { attempts: 1 },
      });
      throw error;
    } finally {
      channel.off('return', onReturn);
    }
  }
  return count;
}
module.exports = { publishOutbox };
