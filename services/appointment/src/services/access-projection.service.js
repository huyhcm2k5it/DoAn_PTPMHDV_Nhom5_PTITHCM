const { createHash } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const { ApiError } = require('../core/errors.js');

function messageHash(message) {
  return createHash('sha256').update(JSON.stringify(message.payload)).digest('hex');
}

async function applyAccessProjection({
  connection,
  message,
  now = new Date(),
  consumerName = 'appointment-access',
}) {
  if (!message || !message.messageId || !message.messageType || !message.payload)
    throw new ApiError(400, 'INVALID_MESSAGE', 'Projection message is incomplete.');
  const inbox = connection.collection('inbox');
  const hash = messageHash(message);
  const existing = await inbox.findOne(
    { message_id: message.messageId, consumer_name: consumerName },
    { projection: { payload_hash: 1 } },
  );
  if (existing) {
    if (existing.payload_hash && existing.payload_hash !== hash)
      throw new ApiError(409, 'MESSAGE_CONFLICT', 'MessageId đã được dùng cho payload khác.');
    return { duplicate: true };
  }
  try {
    return await withMongoTransaction(connection, async (session) => {
      await inbox.insertOne(
        {
          message_id: message.messageId,
          consumer_name: consumerName,
          payload_hash: hash,
          received_at: now,
        },
        { session },
      );
      const payload = message.payload;
      if (message.messageType === 'IdentityAccessChanged') {
        if (!payload.userId || !Number.isInteger(payload.policyVersion))
          throw new ApiError(400, 'INVALID_MESSAGE', 'Identity projection payload is incomplete.');
        const current = await connection
          .collection('user_access_projection')
          .findOne({ userId: payload.userId }, { session });
        if (!current || payload.policyVersion > current.policyVersion)
          await connection.collection('user_access_projection').replaceOne(
            { userId: payload.userId },
            {
              userId: payload.userId,
              actorType: payload.actorType,
              capabilities: payload.capabilities || [],
              status: payload.status,
              tokenVersion: payload.tokenVersion,
              policyVersion: payload.policyVersion,
              updatedAt: now,
            },
            { upsert: true, session },
          );
      } else if (message.messageType === 'PatientAccessChanged') {
        if (!payload.patientId || !payload.ownerUserId || !Number.isInteger(payload.policyVersion))
          throw new ApiError(400, 'INVALID_MESSAGE', 'Patient projection payload is incomplete.');
        const current = await connection
          .collection('patient_access_projection')
          .findOne({ patientId: payload.patientId }, { session });
        if (!current || payload.policyVersion > current.policyVersion)
          await connection.collection('patient_access_projection').replaceOne(
            { patientId: payload.patientId },
            {
              patientId: payload.patientId,
              ownerUserId: payload.ownerUserId,
              active: payload.active !== false,
              policyVersion: payload.policyVersion,
              updatedAt: now,
            },
            { upsert: true, session },
          );
      } else throw new ApiError(400, 'INVALID_MESSAGE', 'Unsupported access projection message.');
      await connection.collection('projection_checkpoints').updateOne(
        { projectionName: message.messageType },
        {
          $set: {
            projectionName: message.messageType,
            lastMessageId: message.messageId,
            updatedAt: now,
          },
        },
        { upsert: true, session },
      );
      return { duplicate: false };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const raced = await inbox.findOne(
        { message_id: message.messageId, consumer_name: consumerName },
        { projection: { payload_hash: 1 } },
      );
      if (raced) {
        if (raced.payload_hash && raced.payload_hash !== hash)
          throw new ApiError(409, 'MESSAGE_CONFLICT', 'MessageId đã được dùng cho payload khác.');
        return { duplicate: true };
      }
    }
    throw error;
  }
}

async function authorizePatientAccess({ connection, authContext, patientId }) {
  if (!connection || !authContext?.userId) return false;
  const patient = await connection
    .collection('patient_access_projection')
    .findOne({ patientId, active: true });
  if (!patient) return false;
  if (authContext.actorType === 'PATIENT') return patient.ownerUserId === authContext.userId;
  if (authContext.actorType === 'STAFF' && authContext.capabilities.includes('RECEPTION')) {
    const user = await connection
      .collection('user_access_projection')
      .findOne({ userId: authContext.userId, status: 'ACTIVE' });
    return Boolean(user?.capabilities?.includes('RECEPTION'));
  }
  return false;
}

module.exports = { applyAccessProjection, authorizePatientAccess };
