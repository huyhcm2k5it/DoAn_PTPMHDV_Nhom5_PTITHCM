const { createHash } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const { ApiError } = require('../core/errors.js');

function hashPayload(payload) { return createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }

async function applyCatalogChanged({ connection, message, now = new Date(), consumerName = 'appointment-catalog' }) {
  if (!message?.messageId || message.messageType !== 'CatalogChanged' || !message.payload)
    throw new ApiError(400, 'INVALID_MESSAGE', 'CatalogChanged message is incomplete.');
  const payload = message.payload;
  const hash = hashPayload(payload);
  const inbox = connection.collection('inbox');
  const existing = await inbox.findOne({ message_id: message.messageId, consumer_name: consumerName });
  if (existing) {
    if (existing.payload_hash && existing.payload_hash !== hash) throw new ApiError(409, 'MESSAGE_CONFLICT', 'MessageId was reused with another payload.');
    return { duplicate: true };
  }
  const projection = connection.collection('catalog_projection');
  const checkpoints = connection.collection('projection_checkpoints');
  const entityKey = payload.entityType && payload.entityId ? `${payload.entityType}:${payload.entityId}` : null;
  if (payload.mode !== 'CHECKPOINT' && !entityKey) throw new ApiError(400, 'INVALID_MESSAGE', 'Catalog entity identity is required.');
  return withMongoTransaction(connection, async (session) => {
    const currentCheckpoint = await checkpoints.findOne({ projectionName: 'CatalogChanged' }, { session });
    if (payload.mode === 'CHECKPOINT') {
      const sequence = Number(payload.streamSequence);
      if (!Number.isInteger(sequence) || sequence < 1) throw new ApiError(400, 'INVALID_MESSAGE', 'Catalog checkpoint sequence is invalid.');
      const previous = Number(currentCheckpoint?.streamSequence || 0);
      await checkpoints.updateOne(
        { projectionName: 'CatalogChanged' },
        { $set: { projectionName: 'CatalogChanged', streamSequence: Math.max(previous, sequence), lastCheckpointAt: now, gap: previous > 0 && sequence > previous + 1, updatedAt: now } },
        { upsert: true, session },
      );
    } else {
      const entityVersion = Number(payload.entityVersion);
      if (!Number.isInteger(entityVersion) || entityVersion < 1) throw new ApiError(400, 'INVALID_MESSAGE', 'Catalog entityVersion is invalid.');
      const current = await projection.findOne({ entityKey }, { session });
      if (current && entityVersion < current.entityVersion) return { duplicate: false, ignored: true };
      if (current && entityVersion === current.entityVersion && current.payload_hash !== hash)
        throw new ApiError(409, 'PROJECTION_CONFLICT', 'Same-version Catalog projection differs.');
      await projection.replaceOne(
        { entityKey },
        { entityKey, entityType: payload.entityType, entityId: payload.entityId, entityVersion, mode: payload.mode, fullSnapshot: payload.fullSnapshot || null, active: payload.mode !== 'TOMBSTONE', effectiveAt: payload.effectiveAt || null, streamSequence: payload.streamSequence || null, payload_hash: hash, updatedAt: now },
        { upsert: true, session },
      );
    }
    await inbox.insertOne({ message_id: message.messageId, consumer_name: consumerName, payload_hash: hash, received_at: now }, { session });
    return { duplicate: false };
  });
}

function createCatalogPriceResolver(connection, { maxCheckpointAgeMs = 30000 } = {}) {
  return async ({ slot, schedule, now = new Date() }) => {
    const checkpoint = await connection.collection('projection_checkpoints').findOne({ projectionName: 'CatalogChanged' });
    if (!checkpoint || checkpoint.gap || !checkpoint.lastCheckpointAt || now.getTime() - new Date(checkpoint.lastCheckpointAt).getTime() > maxCheckpointAgeMs) return null;
    const serviceId = schedule?.serviceId || slot?.serviceId;
    const rows = await connection.collection('catalog_projection').find({ entityType: { $in: ['PRICE', 'SERVICE_PRICE'] }, entityId: serviceId, active: true }).sort({ entityVersion: -1 }).limit(1).toArray();
    const snapshot = rows[0]?.fullSnapshot;
    if (!snapshot || snapshot.amountVnd == null || !snapshot.snapshotHash) return null;
    return { ...snapshot, priceVersion: snapshot.priceVersion ?? rows[0].entityVersion, pricingAt: snapshot.pricingAt || now, expiresAt: snapshot.expiresAt || new Date(now.getTime() + 5 * 60 * 1000) };
  };
}

module.exports = { applyCatalogChanged, createCatalogPriceResolver };
