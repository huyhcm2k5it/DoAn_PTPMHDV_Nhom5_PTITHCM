const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mongoHarness } = require('./test-harness');
const { ensurePharmacyStorage } = require('../../services/pharmacy/src/dbs/indexes');
const { persistDeliveryFailure, drainRetryJobs } = require('../../mongo/durable-retry');
const h = mongoHarness(ensurePharmacyStorage);
const now = new Date('2026-11-07T00:00:00Z');
const delivery = {
  content: Buffer.from(JSON.stringify({ messageId: 'retry-message', payload: {} })),
  fields: { exchange: 'test.events', routingKey: 'test.key' },
  properties: { messageId: 'retry-message' },
};
test('a restart resumes database retry once without relying on broker TTL DLX', async () => {
  await persistDeliveryFailure({
    connection: h.connection,
    delivery,
    consumerName: 'test',
    error: Object.assign(new Error('offline'), { status: 503 }),
    now,
    jitter: () => 0,
  });
  const job = await h.connection.collection('retry_jobs').findOne({});
  assert.equal(job.state, 'PENDING');
  assert.equal(job.nextAttemptAt - now, 5000);
  let applied = 0;
  await drainRetryJobs({
    connection: h.connection,
    consumerName: 'test',
    now: new Date(now.getTime() + 5001),
    dispatch: async (message) => {
      assert.equal(message.messageId, 'retry-message');
      applied++;
    },
  });
  await drainRetryJobs({
    connection: h.connection,
    consumerName: 'test',
    now: new Date(now.getTime() + 6000),
    dispatch: async () => applied++,
  });
  assert.equal(applied, 1);
  assert.equal((await h.connection.collection('retry_jobs').findOne({})).state, 'DONE');
});
test('same message id with changed content is quarantined without replacing the pending delivery', async () => {
  await persistDeliveryFailure({
    connection: h.connection,
    delivery,
    consumerName: 'conflict',
    error: { status: 503 },
    now,
  });
  const changed = {
    ...delivery,
    content: Buffer.from(JSON.stringify({ messageId: 'retry-message', payload: { forged: true } })),
  };
  await persistDeliveryFailure({
    connection: h.connection,
    delivery: changed,
    consumerName: 'conflict',
    error: { status: 503 },
    now,
  });
  const original = await h.connection
    .collection('retry_jobs')
    .findOne({ consumerName: 'conflict' });
  assert.equal(original.content, delivery.content.toString());
  assert.equal(original.state, 'PENDING');
  const bad = await h.connection.collection('dead_letters').findOne({ consumerName: 'conflict' });
  assert.equal(bad.errorCode, 'MESSAGE_CONFLICT');
});
test('invalid delivery persists dead-letter and original content atomically for confirmed quarantine publishing', async () => {
  await persistDeliveryFailure({
    connection: h.connection,
    delivery,
    consumerName: 'bad',
    error: Object.assign(new Error('producer invalid'), { status: 400, code: 'INVALID_MESSAGE' }),
    now,
  });
  assert.equal(await h.connection.collection('dead_letters').countDocuments(), 1);
  const outgoing = await h.connection.collection('outbox').findOne({});
  assert.equal(outgoing.original_message_id, 'retry-message');
  assert.equal(outgoing.delivery_content, delivery.content.toString());
  assert.equal(outgoing.destination_exchange, 'umc.deadletters.bad.v1');
});
