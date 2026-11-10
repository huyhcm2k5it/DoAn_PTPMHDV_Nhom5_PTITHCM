const { randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction');
const { hash, failure } = require('../../../../mongo/catalog-projection');
const INT_MAX = 2147483647;
function uuid(value, name = 'id') {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value || '',
    )
  )
    throw failure(400, 'VALIDATION_ERROR', name + ' must be a UUID.');
  return value;
}
function integer(value, name, max = INT_MAX) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw failure(
      400,
      'VALIDATION_ERROR',
      name + ' must be a positive integer.',
    );
  return value;
}
async function staffAccess(connection, principalId, session, tokenVersion) {
  const user = await connection
    .collection('user_access_projection')
    .findOne({ userId: principalId }, { session });
  if (!user)
    throw failure(
      503,
      'SERVICE_UNAVAILABLE',
      'Identity access projection is unavailable.',
    );
  if (
    user.status !== 'ACTIVE' ||
    user.actorType !== 'STAFF' ||
    !user.capabilities?.includes('PHARMACY') ||
    (tokenVersion != null && user.tokenVersion !== tokenVersion)
  )
    throw failure(403, 'FORBIDDEN', 'Current PHARMACY capability is required.');
  return user;
}
async function mutate(
  {
    connection,
    principalId,
    tokenVersion,
    idempotencyKey,
    route,
    input,
    now = new Date(),
  },
  work,
) {
  uuid(idempotencyKey, 'Idempotency-Key');
  uuid(principalId, 'principalId');
  const query = { principal_id: principalId, route, key: idempotencyKey };
  const request_hash = hash(input);
  const records = connection.collection('idempotency_records');
  const readReplay = async (session) => {
    const previous = await records.findOne(query, { session });
    if (!previous) return null;
    if (previous.request_hash !== request_hash)
      throw failure(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'Key already identifies a different request.',
      );
    return previous.response;
  };
  try {
    return await withMongoTransaction(connection, async (session) => {
      const user = await staffAccess(
        connection,
        principalId,
        session,
        tokenVersion,
      );
      const replay = await readReplay(session);
      if (replay) return replay;
      const response = await work(session, user);
      await records.insertOne(
        { ...query, request_hash, response, created_at: now },
        { session },
      );
      return response;
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    await staffAccess(connection, principalId, undefined, tokenVersion);
    const replay = await readReplay();
    if (replay) return replay;
    throw failure(409, 'STATE_CONFLICT', 'Resource was concurrently changed.');
  }
}
async function outbox(
  connection,
  session,
  {
    type,
    kind = 'EVENT',
    aggregateId,
    version = 1,
    payload,
    correlationId = randomUUID(),
    requestId,
    now = new Date(),
  },
) {
  const id = randomUUID();
  await connection.collection('outbox').insertOne(
    {
      message_id: id,
      message_kind: kind,
      message_type: type,
      schema_version: 1,
      producer: 'pharmacy',
      aggregate_id: aggregateId,
      aggregate_version: version,
      correlation_id: correlationId,
      request_id: requestId || id,
      causation_id: requestId || id,
      occurred_at: now,
      payload,
      published_at: null,
    },
    { session },
  );
  return id;
}
async function consume(
  { connection, message, consumerName, now = new Date() },
  work,
) {
  if (!message?.messageId || !message.payload || message.schemaVersion !== 1)
    throw failure(400, 'INVALID_MESSAGE', 'Invalid versioned envelope.');
  const query = { message_id: message.messageId, consumer_name: consumerName };
  const payload_hash = hash({
    kind: message.messageKind,
    type: message.messageType,
    producer: message.producer,
    payload: message.payload,
  });
  const inbox = connection.collection('inbox');
  const replay = async (session) => {
    const prior = await inbox.findOne(query, { session });
    if (prior && prior.payload_hash !== payload_hash)
      throw failure(
        409,
        'MESSAGE_CONFLICT',
        'Message id identifies different content.',
      );
    return prior;
  };
  try {
    return await withMongoTransaction(connection, async (session) => {
      const previous = await replay(session);
      if (previous) {
        if (previous.result?.responseMessageId)
          await connection
            .collection('outbox')
            .updateOne(
              { message_id: previous.result.responseMessageId },
              { $set: { published_at: null } },
              { session },
            );
        return { duplicate: true, ...previous.result };
      }
      const result = await work(session);
      await inbox.insertOne(
        { ...query, payload_hash, result, received_at: now },
        { session },
      );
      return { duplicate: false, ...result };
    });
  } catch (error) {
    if (error.code !== 11000 || !(await replay())) throw error;
    return { duplicate: true };
  }
}
function pending(hold) {
  return {
    requestId: hold.requestId,
    holdId: hold.id,
    state: hold.status,
    statusUrl:
      '/api/v1/pharmacy/prescriptions/' +
      hold.prescriptionId +
      '?revision=' +
      hold.revision +
      '&holdId=' +
      hold.id,
  };
}
module.exports = {
  uuid,
  integer,
  INT_MAX,
  staffAccess,
  mutate,
  consume,
  outbox,
  pending,
  hash,
  failure,
};
