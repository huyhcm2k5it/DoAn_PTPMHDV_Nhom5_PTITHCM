const { createHash } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction');
const { ApiError } = require('../core/errors');

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const envelopeFields = [
  'messageId',
  'messageKind',
  'messageType',
  'schemaVersion',
  'producer',
  'aggregateId',
  'aggregateVersion',
  'correlationId',
  'causationId',
  'requestId',
  'occurredAt',
  'payload',
];
const payloadFields = [
  'userId',
  'status',
  'actorType',
  'capabilities',
  'tokenVersion',
  'phoneVerified',
  'version',
];
const states = [
  'UNVERIFIED',
  'ACTIVE',
  'LOCKED',
  'BLOCKED',
  'PENDING_VERIFICATION',
];
const isUuid = (value) => typeof value === 'string' && UUID.test(value);
const positive = (value) => Number.isSafeInteger(value) && value >= 1;
function invalid() {
  throw new ApiError(400, 'INVALID_MESSAGE', 'Invalid Identity access event.');
}
function exactFields(value, fields) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((key) => Object.hasOwn(value, key))
  );
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
function snapshot(value) {
  return {
    userId: value.userId,
    actorType: value.actorType,
    capabilities: [...value.capabilities].sort(),
    status: value.status,
    tokenVersion: value.tokenVersion,
    phoneVerified: value.phoneVerified,
    policyVersion: value.version ?? value.policyVersion,
  };
}
function validate(message) {
  if (
    !exactFields(message, envelopeFields) ||
    message.messageKind !== 'EVENT' ||
    message.messageType !== 'IdentityAccessChanged' ||
    message.schemaVersion !== 1 ||
    message.producer !== 'identity' ||
    !isUuid(message.messageId) ||
    !isUuid(message.aggregateId) ||
    !positive(message.aggregateVersion) ||
    typeof message.correlationId !== 'string' ||
    !message.correlationId.length ||
    message.correlationId.length > 128 ||
    ![message.requestId, message.causationId].every(
      (value) =>
        value === null || (typeof value === 'string' && UUID.test(value)),
    ) ||
    typeof message.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(message.occurredAt))
  )
    invalid();
  const p = message.payload;
  if (
    !exactFields(p, payloadFields) ||
    !isUuid(p.userId) ||
    p.userId !== message.aggregateId ||
    p.version !== message.aggregateVersion ||
    !positive(p.version) ||
    !positive(p.tokenVersion) ||
    !['PATIENT', 'DOCTOR', 'STAFF'].includes(p.actorType) ||
    !states.includes(p.status) ||
    typeof p.phoneVerified !== 'boolean' ||
    !Array.isArray(p.capabilities) ||
    p.capabilities.some((value) => typeof value !== 'string' || !value.length)
  )
    invalid();
  // Legacy queued registration events remain denied; new producers emit UNVERIFIED.
  return snapshot(p);
}
async function applyIdentityAccessChanged({
  connection,
  message,
  now = new Date(),
}) {
  const value = validate(message);
  const payloadHash = hash(message);
  const inboxKey = {
    message_id: message.messageId,
    consumer_name: 'patient-identity',
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await withMongoTransaction(connection, async (session) => {
        const inbox = connection.collection('inbox');
        const existing = await inbox.findOne(inboxKey, { session });
        if (existing) {
          if (existing.payload_hash !== payloadHash)
            throw new ApiError(
              409,
              'MESSAGE_CONFLICT',
              'Message ID identifies different content.',
            );
          return { duplicate: true };
        }
        const projections = connection.collection('user_access_projection');
        const current = await projections.findOne(
          { userId: value.userId },
          { session },
        );
        if (
          current?.policyVersion === value.policyVersion &&
          hash(snapshot(current)) !== hash(value)
        ) {
          throw new ApiError(
            409,
            'PROJECTION_CONFLICT',
            'Same-version Identity snapshot differs.',
          );
        }
        if (!current || current.policyVersion < value.policyVersion) {
          await projections.replaceOne(
            { userId: value.userId },
            { ...value, updatedAt: now },
            { session, upsert: true },
          );
        }
        await inbox.insertOne(
          { ...inboxKey, payload_hash: payloadHash, received_at: now },
          { session },
        );
        return { duplicate: false };
      });
    } catch (error) {
      if (error.code !== 11000 || attempt) throw error;
      // A concurrent delivery may have installed the unique inbox/user row first.
    }
  }
}
module.exports = { applyIdentityAccessChanged };
