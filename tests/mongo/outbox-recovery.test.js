const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { mongoHarness } = require('./test-harness');
const { ensurePharmacyStorage } = require('../../services/pharmacy/src/dbs/indexes');
const {
  publishPharmacyOutboxBatch,
} = require('../../services/pharmacy/src/workers/outbox-publisher.worker');
const h = mongoHarness(ensurePharmacyStorage);
test('mandatory return preserves outbox and retry drains after confirm without changing message ID', async () => {
  const id = randomUUID();
  await h.connection.collection('outbox').insertOne({
    message_id: id,
    message_kind: 'COMMAND',
    message_type: 'RequestCharge',
    producer: 'pharmacy',
    schema_version: 1,
    aggregate_id: randomUUID(),
    aggregate_version: 1,
    correlation_id: 'test',
    request_id: randomUUID(),
    occurred_at: new Date(),
    payload: {},
  });
  const channel = new EventEmitter();
  channel.assertExchange = async () => {};
  let returns = true,
    published;
  channel.publish = (exchange, key, body, properties) => {
    published = JSON.parse(body);
    if (returns) channel.emit('return', { properties });
    return true;
  };
  channel.waitForConfirms = async () => {};
  await assert.rejects(
    publishPharmacyOutboxBatch({ connection: h.connection, channel }),
    /OUTBOX_UNROUTABLE/,
  );
  assert.equal(
    (await h.connection.collection('outbox').findOne({ message_id: id })).published_at,
    undefined,
  );
  returns = false;
  const now = new Date(Date.now() + 6000);
  assert.equal(await publishPharmacyOutboxBatch({ connection: h.connection, channel, now }), 1);
  assert.equal(published.messageId, id);
  assert.ok(published.requestId);
  assert.ok((await h.connection.collection('outbox').findOne({ message_id: id })).published_at);
});
