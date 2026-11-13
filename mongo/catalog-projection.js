const { createHash } = require('node:crypto');
const { withMongoTransaction } = require('./transaction');

function canonical(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function hash(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function failure(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
async function applyCatalogChanged({
  connection,
  message,
  now = new Date(),
  consumerName = 'catalog-projection',
}) {
  if (
    !message?.messageId ||
    message.messageType !== 'CatalogChanged' ||
    message.messageKind !== 'EVENT' ||
    message.schemaVersion !== 1 ||
    !['catalog', 'Catalog'].includes(message.producer) ||
    !message.payload
  )
    throw failure(400, 'INVALID_MESSAGE', 'Invalid Catalog envelope.');
  const p = message.payload;
  const sequence = p.streamSequence;
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < (p.mode === 'CHECKPOINT' ? 0 : 1) ||
    !['UPSERT', 'TOMBSTONE', 'CHECKPOINT'].includes(p.mode) ||
    !p.entityType ||
    !p.entityId ||
    !Number.isInteger(p.entityVersion) ||
    p.entityVersion < 1
  )
    throw failure(400, 'INVALID_MESSAGE', 'Invalid Catalog snapshot.');
  const inbox = connection.collection('inbox');
  const payloadHash = hash(p);
  const projection = connection.collection('catalog_projection');
  const checkpoints = connection.collection('projection_checkpoints');
  const consume = async (session) => {
    const old = await inbox.findOne(
      { message_id: message.messageId, consumer_name: consumerName },
      { session },
    );
    if (old) {
      if (old.payload_hash !== payloadHash)
        throw failure(409, 'MESSAGE_CONFLICT', 'Changed message payload.');
      return { duplicate: true };
    }
    const cp = await checkpoints.findOne({ projectionName: 'CatalogChanged' }, { session });
    const previous = cp?.streamSequence ?? 0;
    const isCheckpoint = p.mode === 'CHECKPOINT';
    // Parallel deliveries may commit in a different order from the broker.
    // Only observed entity sequences advance the contiguous watermark.
    // A heartbeat proves freshness, never receipt of the missing entities.
    const legacyGap = Boolean(cp?.legacyGap) || Boolean(cp?.gap && cp?.pendingSequences === undefined);
    if (sequence > previous + 10000) {
      throw failure(503, 'CATALOG_SEQUENCE_WINDOW_EXCEEDED', 'Catalog stream requires an owner snapshot.');
    }
    const pending = new Set(cp?.pendingSequences || []);
    if (!isCheckpoint && sequence > previous) pending.add(sequence);
    let contiguous = previous;
    while (pending.delete(contiguous + 1)) contiguous++;
    if (pending.size > 1024) {
      throw failure(503, 'CATALOG_SEQUENCE_WINDOW_EXCEEDED', 'Catalog stream requires an owner snapshot.');
    }
    const checkpointSequence = Math.max(cp?.checkpointSequence || 0, isCheckpoint ? sequence : 0);
    const gap = legacyGap || pending.size > 0 || checkpointSequence > contiguous;
    if (!isCheckpoint) {
      const entityKey = p.entityType + ':' + p.entityId;
      const contentHash = hash({
        mode: p.mode,
        fullSnapshot: p.fullSnapshot,
        effectiveAt: p.effectiveAt,
      });
      const current = await projection.findOne({ entityKey }, { session });
      if (current?.entityVersion === p.entityVersion && current.contentHash !== contentHash)
        throw failure(409, 'PROJECTION_CONFLICT', 'Same-version Catalog snapshot differs.');
      if (!current || current.entityVersion < p.entityVersion)
        await projection.replaceOne(
          { entityKey },
          {
            entityKey,
            entityType: p.entityType,
            entityId: p.entityId,
            entityVersion: p.entityVersion,
            fullSnapshot: p.fullSnapshot,
            active: p.mode !== 'TOMBSTONE',
            mode: p.mode,
            effectiveAt: p.effectiveAt,
            streamSequence: sequence,
            contentHash,
            updatedAt: now,
          },
          { upsert: true, session },
        );
    }
    await checkpoints.updateOne(
      { projectionName: 'CatalogChanged' },
      {
        $set: {
          projectionName: 'CatalogChanged',
          streamSequence: contiguous,
          pendingSequences: [...pending].sort((a, b) => a - b),
          checkpointSequence,
          legacyGap,
          gap,
          updatedAt: now,
          ...(isCheckpoint ? { lastCheckpointAt: now } : {}),
        },
      },
      { upsert: true, session },
    );
    await inbox.insertOne(
      {
        message_id: message.messageId,
        consumer_name: consumerName,
        payload_hash: payloadHash,
        received_at: now,
      },
      { session },
    );
    return { duplicate: false };
  };
  try {
    return await withMongoTransaction(connection, consume);
  } catch (error) {
    if (error.code !== 11000) throw error;
    const row = await inbox.findOne({ message_id: message.messageId, consumer_name: consumerName });
    if (!row) throw error;
    if (row.payload_hash !== payloadHash)
      throw failure(409, 'MESSAGE_CONFLICT', 'Changed message payload.');
    return { duplicate: true };
  }
}
async function resolveCatalogPrice(
  connection,
  itemId,
  { now = new Date(), session, maxCheckpointAgeMs = 30000 } = {},
) {
  const cp = await connection
    .collection('projection_checkpoints')
    .findOne({ projectionName: 'CatalogChanged' }, { session });
  const age = now - new Date(cp?.lastCheckpointAt);
  if (!cp || cp.gap || !Number.isFinite(age) || age < 0 || age > maxCheckpointAgeMs) return null;
  const rows = await connection
    .collection('catalog_projection')
    .find(
      {
        entityType: 'PRICE_VERSION',
        active: true,
        'fullSnapshot.itemId': itemId,
      },
      { session },
    )
    .toArray();
  const active = rows
    .map((row) => ({ row, s: row.fullSnapshot }))
    .filter(
      ({ s }) =>
        (!s.status || s.status === 'ACTIVE') &&
        Number.isSafeInteger(s.amountVnd) &&
        s.amountVnd >= 0 &&
        Number.isFinite(Date.parse(s.effectiveFrom)) &&
        new Date(s.effectiveFrom) <= now &&
        (!s.effectiveTo || now < new Date(s.effectiveTo)),
    );
  if (active.length !== 1) return null;
  const { row, s } = active[0];
  const quote = {
    itemId,
    priceVersionId: s.priceVersionId || row.entityId,
    priceVersion: s.revision || row.entityVersion,
    amountVnd: s.amountVnd,
    currency: 'VND',
    pricingAt: now.toISOString(),
    expiresAt: new Date(
      Math.min(
        now.getTime() + 5 * 60000,
        s.effectiveTo ? new Date(s.effectiveTo).getTime() : Infinity,
      ),
    ).toISOString(),
  };
  return { ...quote, snapshotHash: hash(quote) };
}
function createCatalogPriceResolver(connection, options = {}) {
  return ({ slot, schedule, now = new Date(), session }) =>
    resolveCatalogPrice(connection, schedule?.serviceId || slot?.serviceId, {
      ...options,
      now,
      session,
    });
}
module.exports = {
  applyCatalogChanged,
  createCatalogPriceResolver,
  resolveCatalogPrice,
  canonical,
  hash,
  failure,
};
