const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { mongoHarness } = require('./test-harness');
const {
  ensurePatientStorage,
} = require('../../services/patient/src/dbs/indexes');
const {
  persistDeliveryFailure,
  drainRetryJobs,
} = require('../../mongo/durable-retry');
const {
  publishPatientOutboxBatch,
} = require('../../services/patient/src/workers/outbox-publisher.worker');
const {
  publishOutboxBatch,
} = require('../../services/appointment/src/workers/outbox-publisher.worker');
const {
  publishPharmacyOutboxBatch,
} = require('../../services/pharmacy/src/workers/outbox-publisher.worker');

const h = mongoHarness(ensurePatientStorage, 'patient_db');
const now = new Date('2026-11-11T00:00:00Z');
const publishers = [
  ['patient', publishPatientOutboxBatch],
  ['appointment', publishOutboxBatch],
  ['pharmacy', publishPharmacyOutboxBatch],
];

function delivery(content, messageId = randomUUID()) {
  return {
    content,
    properties: { messageId },
    fields: { exchange: 'test.events', routingKey: 'test.key' },
  };
}
function channelProbe() {
  const channel = new EventEmitter();
  const sent = [];
  channel.assertExchange = async () => {};
  channel.publish = (exchange, key, content, properties) => {
    sent.push({ exchange, key, content, properties });
    return true;
  };
  channel.waitForConfirms = async () => {};
  return { channel, sent };
}
function persist(
  input,
  consumerName,
  error = { status: 400, code: 'INVALID_MESSAGE' },
) {
  return persistDeliveryFailure({
    connection: h.connection,
    delivery: input,
    consumerName,
    error,
    now,
    jitter: () => 0,
  });
}

for (const [consumerName, publish] of publishers) {
  for (const [label, body] of [
    ['invalid UTF-8', Buffer.from([0xff, 0x80, 0x7b])],
    ['empty', Buffer.alloc(0)],
  ]) {
    test(`${consumerName} quarantine preserves ${label} bytes and original ID after duplicate delivery`, async () => {
      const input = delivery(body);
      await persist(input, consumerName);
      await persist(input, consumerName);
      const { channel, sent } = channelProbe();
      assert.equal(
        await publish({ connection: h.connection, channel, now }),
        1,
      );
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0].content, body);
      assert.equal(sent[0].properties.messageId, input.properties.messageId);
      assert.equal(sent[0].exchange, `umc.deadletters.${consumerName}.v1`);
      assert.equal(sent[0].key, `${consumerName}.quarantine.v1`);
      assert.equal(
        await h.connection.collection('retry_jobs').countDocuments(),
        1,
      );
      assert.equal(
        await h.connection.collection('dead_letters').countDocuments(),
        1,
      );
      assert.equal(await h.connection.collection('outbox').countDocuments(), 1);
      const retry = await h.connection.collection('retry_jobs').findOne({});
      const dead = await h.connection.collection('dead_letters').findOne({});
      assert.equal(retry.contentBase64, body.toString('base64'));
      assert.equal(dead.contentBase64, body.toString('base64'));
      assert.equal(retry.content, body.toString('utf8'));
    });
  }

  test(`${consumerName} publisher still supports legacy quarantine text including empty bodies`, async () => {
    for (const body of ['{legacy-invalid-json', '']) {
      const input = delivery(Buffer.from(body));
      await persist(input, consumerName);
    }
    await h.connection
      .collection('outbox')
      .updateMany({}, { $unset: { delivery_content_base64: '' } });
    const { channel, sent } = channelProbe();
    assert.equal(await publish({ connection: h.connection, channel, now }), 2);
    assert.deepEqual(
      sent.map((item) => item.content.toString()),
      ['{legacy-invalid-json', ''],
    );
  });
}

test('different invalid UTF-8 bytes with one ID create a conflict without replacing the pending delivery', async () => {
  const first = delivery(Buffer.from([0xff]));
  const changed = delivery(Buffer.from([0xfe]), first.properties.messageId);
  // Both decode to the same replacement character; only the raw bytes differ.
  assert.equal(first.content.toString(), changed.content.toString());
  await persist(first, 'patient', { status: 503 });
  await persist(first, 'patient', { status: 503 });
  await persist(changed, 'patient', { status: 503 });
  const conflicts = await h.connection
    .collection('dead_letters')
    .find({})
    .toArray();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].errorCode, 'MESSAGE_CONFLICT');
  assert.equal(conflicts[0].contentBase64, '/g==');
  const pending = await h.connection.collection('retry_jobs').findOne({});
  assert.equal(pending.contentBase64, '/w==');
  assert.equal(pending.state, 'PENDING');
  const { channel, sent } = channelProbe();
  await publishPatientOutboxBatch({ connection: h.connection, channel, now });
  assert.deepEqual(sent[0].content, changed.content);
  assert.equal(sent[0].properties.messageId, first.properties.messageId);
});

test('retry exhaustion carries the original bytes through dead-letter and outbox storage', async () => {
  const input = delivery(Buffer.from([0xff, 0x80, 0x7b]));
  await persist(input, 'patient', { status: 503 });
  for (const offset of [5001, 20002, 80003]) {
    await drainRetryJobs({
      connection: h.connection,
      consumerName: 'patient',
      now: new Date(now.getTime() + offset),
      dispatch: async () => {
        throw Object.assign(new Error('still unavailable'), { status: 503 });
      },
      jitter: () => 0,
    });
  }
  const { channel, sent } = channelProbe();
  await publishPatientOutboxBatch({ connection: h.connection, channel, now });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].content, input.content);
  assert.equal(sent[0].properties.messageId, input.properties.messageId);
  assert.equal(
    (await h.connection.collection('retry_jobs').findOne({})).state,
    'QUARANTINED',
  );
});

test('legacy retry rows without raw bytes continue dispatching their JSON content', async () => {
  const message = { messageId: randomUUID(), payload: { state: 'ACTIVE' } };
  await persist(delivery(Buffer.from(JSON.stringify(message))), 'patient', {
    status: 503,
  });
  await h.connection
    .collection('retry_jobs')
    .updateMany({}, { $unset: { contentBase64: '' } });
  const received = [];
  await drainRetryJobs({
    connection: h.connection,
    consumerName: 'patient',
    now: new Date(now.getTime() + 5001),
    dispatch: async (value) => received.push(value),
  });
  assert.deepEqual(received, [message]);
  assert.equal(
    (await h.connection.collection('retry_jobs').findOne({})).state,
    'DONE',
  );
});
