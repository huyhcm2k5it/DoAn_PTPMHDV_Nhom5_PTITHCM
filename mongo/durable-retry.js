const { createHash, randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('./transaction');
const delays = [5000, 15000, 60000];
function deliveryId(delivery) {
  const usableId = value => typeof value === 'string' && value.trim().length > 0 &&
    Buffer.byteLength(value, 'utf8') <= 255;
  try {
    const m = JSON.parse(delivery.content.toString());
    if (usableId(m?.messageId)) return m.messageId;
  } catch {
    /* malformed */
  }
  return (
    usableId(delivery.properties?.messageId) ? delivery.properties.messageId : createHash('sha256').update(delivery.content).digest('hex')
  );
}
async function quarantine(connection, session, value, error, now) {
  await connection.collection('dead_letters').updateOne(
    { id: value.id },
    {
      $setOnInsert: {
        ...value,
        state: 'QUARANTINED',
        errorCode: error.code || error.name,
        quarantinedAt: now,
      },
    },
    { upsert: true, session },
  );
  const messageId = 'dead:' + value.id;
  await connection.collection('outbox').updateOne(
    { message_id: messageId },
    {
      $setOnInsert: {
        message_id: messageId,
        original_message_id: value.messageId,
        message_kind: 'EVENT',
        message_type: 'DeliveryQuarantined',
        schema_version: 1,
        producer: value.consumerName,
        aggregate_id: value.id,
        aggregate_version: 1,
        correlation_id: value.messageId,
        occurred_at: now,
        delivery_content: value.content,
        ...(typeof value.contentBase64 === 'string'
          ? { delivery_content_base64: value.contentBase64 }
          : {}),
        published_at: null,
        destination_exchange: 'umc.deadletters.' + value.consumerName + '.v1',
        destination_key: value.consumerName + '.quarantine.v1',
      },
    },
    { upsert: true, session },
  );
}
async function persistDeliveryFailure({
  connection,
  delivery,
  consumerName,
  error,
  now = new Date(),
  jitter = () => Math.floor(Math.random() * 500),
}) {
  const messageId = deliveryId(delivery),
    id = consumerName + ':' + messageId;
  const value = {
    id,
    consumerName,
    messageId,
    content: delivery.content.toString('utf8'),
    contentBase64: delivery.content.toString('base64'),
    exchange: delivery.fields.exchange,
    routingKey: delivery.fields.routingKey,
  };
  return withMongoTransaction(connection, async (session) => {
    const jobs = connection.collection('retry_jobs');
    const previous = await jobs.findOne({ id }, { session });
    if (previous) {
      const previousContent = typeof previous.contentBase64 === 'string'
        ? previous.contentBase64
        : Buffer.from(previous.content, 'utf8').toString('base64');
      if (
        previousContent !== value.contentBase64 ||
        previous.exchange !== value.exchange ||
        previous.routingKey !== value.routingKey
      ) {
        const fingerprint = createHash('sha256').update(JSON.stringify(value)).digest('hex');
        await quarantine(
          connection,
          session,
          { ...value, id: id + ':conflict:' + fingerprint },
          { code: 'MESSAGE_CONFLICT' },
          now,
        );
      }
      return;
    }
    const retryable = !Number.isInteger(error.status) || error.status >= 500;
    if (!retryable) await quarantine(connection, session, value, error, now);
    await jobs.insertOne(
      {
        ...value,
        state: retryable ? 'PENDING' : 'QUARANTINED',
        attempts: 0,
        nextAttemptAt: new Date(now.getTime() + delays[0] + jitter()),
        createdAt: now,
        updatedAt: now,
      },
      { session },
    );
    await connection
      .collection('inbox')
      .insertOne(
        {
          message_id: messageId,
          consumer_name: consumerName + '-delivery',
          state: retryable ? 'RETRY_SCHEDULED' : 'QUARANTINED',
          received_at: now,
        },
        { session },
      );
  });
}
async function drainRetryJobs({
  connection,
  consumerName,
  dispatch,
  now = new Date(),
  jitter = () => Math.floor(Math.random() * 500),
  limit = 20,
}) {
  const jobs = connection.collection('retry_jobs');
  const due = {
    consumerName,
    state: 'PENDING',
    nextAttemptAt: { $lte: now },
    $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
  };
  const rows = await jobs.find(due).sort({ nextAttemptAt: 1 }).limit(limit).toArray();
  for (const row of rows) {
    const workerId = randomUUID();
    const claimed = await jobs.updateOne(
      { ...due, id: row.id },
      { $set: { workerId, leaseUntil: new Date(now.getTime() + 30000) } },
    );
    if (!claimed.modifiedCount) continue;
    let error;
    try {
      await dispatch(JSON.parse(row.content), row.exchange, row.routingKey);
    } catch (caught) {
      error = caught;
    }
    await withMongoTransaction(connection, async (session) => {
      if (!(await jobs.findOne({ id: row.id, workerId }, { session }))) return;
      const attempts = row.attempts + 1;
      const terminal =
        error && (attempts >= 3 || (Number.isInteger(error.status) && error.status < 500));
      if (terminal) await quarantine(connection, session, row, error, now);
      const state = !error ? 'DONE' : terminal ? 'QUARANTINED' : 'PENDING';
      await jobs.updateOne(
        { id: row.id, workerId },
        {
          $set: {
            state,
            attempts,
            nextAttemptAt: new Date(now.getTime() + (delays[attempts] || 60000) + jitter()),
            updatedAt: now,
            leaseUntil: null,
            workerId: null,
          },
        },
        { session },
      );
      await connection
        .collection('inbox')
        .updateOne(
          { message_id: row.messageId, consumer_name: consumerName + '-delivery' },
          { $set: { state } },
          { session },
        );
    });
  }
  return rows.length;
}
module.exports = { persistDeliveryFailure, drainRetryJobs, delays };
