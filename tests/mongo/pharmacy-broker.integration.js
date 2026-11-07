const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const amqp = require('../../services/pharmacy/node_modules/amqplib');
const { mongoHarness } = require('./test-harness');
const { ensurePharmacyStorage } = require('../../services/pharmacy/src/dbs/indexes');
const { startPharmacyWorker } = require('../../services/pharmacy/src/workers/amqp-runtime');
const {
  publishPharmacyOutboxBatch,
} = require('../../services/pharmacy/src/workers/outbox-publisher.worker');
const sample = require('../../contracts/messages/examples/catalog-price-upsert.json');
const url = process.env.TEST_AMQP_URL;
if (!url || !new URL(url).pathname.startsWith('/quan-ci-'))
  throw new Error(
    'TEST_AMQP_URL must name an isolated quan-ci-* vhost. This test never silently skips.',
  );
const h = mongoHarness(ensurePharmacyStorage);
async function until(work, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await work();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Broker integration condition timed out.');
}
test('real broker replays after consumer restart and quarantines invalid producer with original ID', async (t) => {
  let worker = await startPharmacyWorker({
    connection: h.connection,
    connect: amqp.connect,
    amqpUrl: url,
  });
  const broker = await amqp.connect(url),
    channel = await broker.createConfirmChannel();
  t.after(async () => {
    await worker.close();
    await channel.close();
    await broker.close();
  });
  const message = {
    ...sample,
    messageId: randomUUID(),
    payload: { ...sample.payload, streamSequence: 1 },
  };
  const send = async (envelope) => {
    channel.publish(
      'umc.events.catalog.v1',
      'catalog.catalog-changed.v1',
      Buffer.from(JSON.stringify(envelope)),
      {
        persistent: true,
        mandatory: true,
        contentType: 'application/json',
        messageId: envelope.messageId,
      },
    );
    await channel.waitForConfirms();
  };
  await send(message);
  await until(() =>
    h.connection
      .collection('inbox')
      .findOne({ message_id: message.messageId, consumer_name: 'pharmacy-catalog' }),
  );
  await worker.close();
  worker = await startPharmacyWorker({
    connection: h.connection,
    connect: amqp.connect,
    amqpUrl: url,
  });
  await send(message);
  const second = { ...message, messageId: randomUUID(), producer: 'browser' };
  await send(second);
  await until(() =>
    h.connection.collection('dead_letters').findOne({ messageId: second.messageId }),
  );
  assert.equal(
    await h.connection
      .collection('inbox')
      .countDocuments({ message_id: message.messageId, consumer_name: 'pharmacy-catalog' }),
    1,
  );
  await publishPharmacyOutboxBatch({ connection: h.connection, channel: worker.channel });
  const quarantined = await until(
    async () => await channel.get('dlq.pharmacy.v1', { noAck: true }),
  );
  assert.equal(quarantined.properties.messageId, second.messageId);
  assert.equal(JSON.parse(quarantined.content).producer, 'browser');
});
