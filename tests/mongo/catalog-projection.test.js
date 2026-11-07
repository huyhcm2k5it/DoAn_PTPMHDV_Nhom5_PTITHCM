const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mongoHarness } = require('./test-harness');
const { ensureAppointmentStorage } = require('../../services/appointment/src/dbs/indexes');
const { applyCatalogChanged, createCatalogPriceResolver } = require('../../services/appointment/src/services/catalog-projection.service');
const sample = require('../../contracts/messages/examples/catalog-price-upsert.json');
const h = mongoHarness(ensureAppointmentStorage, 'appointment_db');
const now = new Date('2026-11-07T00:00:00Z');
function event(sequence, overrides = {}) {
  return { ...sample, messageId: randomUUID(), occurredAt: now.toISOString(),
    payload: { ...sample.payload, streamSequence: sequence, ...overrides } };
}
async function apply(message) {
  return applyCatalogChanged({ connection: h.connection, message, now });
}
async function checkpoint(sequence) {
  return apply(event(sequence, { mode: 'CHECKPOINT', entityType: 'STREAM',
    entityId: '00000000-0000-4000-8000-000000000000', entityVersion: 1, fullSnapshot: {} }));
}
test('PRICE_VERSION resolves by itemId and produces a stable immutable quote', async () => {
  await apply(event(1));
  await checkpoint(1);
  const resolve = createCatalogPriceResolver(h.connection);
  const quote = await resolve({ schedule: { serviceId: sample.payload.fullSnapshot.itemId }, now });
  assert.ok(quote, 'canonical Catalog price must be usable');
  assert.equal(quote.amountVnd, 125000);
  assert.equal(quote.priceVersionId, sample.payload.entityId);
  assert.match(quote.snapshotHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(await resolve({ schedule: { serviceId: sample.payload.fullSnapshot.itemId }, now }), quote);
  assert.equal(await resolve({ schedule: { serviceId: randomUUID() }, now }), null);
});
test('zero checkpoint is valid but an unobserved stream gap stays closed after checkpoints', async () => {
  await checkpoint(0);
  assert.equal((await h.connection.collection('projection_checkpoints').findOne({ projectionName: 'CatalogChanged' })).gap, false);
  await apply(event(2));
  await checkpoint(2);
  await checkpoint(2);
  assert.equal((await h.connection.collection('projection_checkpoints').findOne({ projectionName: 'CatalogChanged' })).gap, true);
  assert.equal(await createCatalogPriceResolver(h.connection)({ schedule: { serviceId: sample.payload.fullSnapshot.itemId }, now }), null);
});
test('same entity version in a later stream delivery is duplicate unless snapshot differs', async () => {
  await apply(event(1));
  await apply(event(2));
  await assert.rejects(apply(event(3, { fullSnapshot: { ...sample.payload.fullSnapshot, amountVnd: 1 } })),
    error => error.code === 'PROJECTION_CONFLICT');
});
test('future price and tombstones never become a current price', async () => {
  await apply(event(1, { fullSnapshot: { ...sample.payload.fullSnapshot, effectiveFrom: '2027-01-01T00:00:00Z' } }));
  await checkpoint(1);
  assert.equal(await createCatalogPriceResolver(h.connection)({ schedule: { serviceId: sample.payload.fullSnapshot.itemId }, now }), null);
  await apply(event(2, { entityVersion: 2, mode: 'TOMBSTONE' }));
  await checkpoint(2);
  assert.equal(await createCatalogPriceResolver(h.connection)({ schedule: { serviceId: sample.payload.fullSnapshot.itemId }, now }), null);
});
