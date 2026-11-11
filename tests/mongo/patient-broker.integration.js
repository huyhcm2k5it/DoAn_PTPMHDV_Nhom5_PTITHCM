const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const amqp = require('../../services/patient/node_modules/amqplib');
const { mongoHarness } = require('./test-harness');
const {
  ensurePatientStorage,
} = require('../../services/patient/src/dbs/indexes');
const {
  startPatientWorker,
} = require('../../services/patient/src/workers/amqp-runtime');
const {
  publishPatientOutboxBatch,
} = require('../../services/patient/src/workers/outbox-publisher.worker');
const {
  createPatient,
} = require('../../services/patient/src/services/manage-patient.service');
const {
  getPatientModel,
} = require('../../services/patient/src/models/patient.model');
const url = process.env.TEST_AMQP_URL;
if (!url || !new URL(url).pathname.startsWith('/quan-ci-'))
  throw new Error('TEST_AMQP_URL must select an isolated quan-ci-* vhost.');
const h = mongoHarness(ensurePatientStorage, 'patient_db');
async function until(work) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await work();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Patient broker condition timed out.');
}
test('real Identity events unblock Patient, survive consumer restart and quarantine forged events without granting access', async (t) => {
  let worker = await startPatientWorker({
    connection: h.connection,
    amqpUrl: url,
    connect: amqp.connect,
  });
  const broker = await amqp.connect(url);
  const channel = await broker.createConfirmChannel();
  const observer = await channel.assertQueue('', {
    exclusive: true,
    durable: false,
    autoDelete: true,
  });
  await channel.bindQueue(
    observer.queue,
    'umc.events.patient.v1',
    'patient.patient-access-changed.v1',
  );

  t.after(async () => {
    await worker.close();
    await channel.close();
    await broker.close();
  });
  const userId = randomUUID();
  const event = (version, status) => ({
    messageId: randomUUID(),
    messageKind: 'EVENT',
    messageType: 'IdentityAccessChanged',
    schemaVersion: 1,
    producer: 'identity',
    aggregateId: userId,
    aggregateVersion: version,
    correlationId: randomUUID(),
    causationId: randomUUID(),
    requestId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      userId,
      actorType: 'PATIENT',
      capabilities: [],
      status,
      tokenVersion: 1,
      phoneVerified: status === 'ACTIVE',
      version,
    },
  });
  const send = async (message) => {
    channel.publish(
      'umc.events.identity.v1',
      'identity.identity-access-changed.v1',
      Buffer.from(JSON.stringify(message)),
      { persistent: true, mandatory: true, messageId: message.messageId },
    );
    await channel.waitForConfirms();
  };
  await send(event(1, 'UNVERIFIED'));
  const active = event(2, 'ACTIVE');
  await send(active);
  await until(
    async () =>
      (
        await h.connection
          .collection('user_access_projection')
          .findOne({ userId })
      )?.status === 'ACTIVE',
  );
  const input = {
    connection: h.connection,
    Patient: getPatientModel(h.connection),
    authContext: { userId, actorType: 'PATIENT', tokenVersion: 1 },
    body: {
      fullName: 'DEMO Broker Patient',
      birthDate: '2000-01-02',
      relation: 'SELF',
    },
    idempotencyKey: randomUUID(),
  };
  const patient = await createPatient(input);
  assert.equal(patient.ownerUserId, userId);
  await worker.close();
  await send(event(3, 'BLOCKED'));
  assert.ok((await channel.checkQueue('evt.patient.v1')).messageCount >= 1);
  worker = await startPatientWorker({
    connection: h.connection,
    amqpUrl: url,
    connect: amqp.connect,
  });
  await until(
    async () =>
      (
        await h.connection
          .collection('user_access_projection')
          .findOne({ userId })
      )?.status === 'BLOCKED',
  );
  await send(active);
  const forged = { ...event(4, 'ACTIVE'), producer: 'browser' };
  await send(forged);
  await until(() =>
    h.connection
      .collection('dead_letters')
      .findOne({ messageId: forged.messageId }),
  );
  assert.equal(
    (
      await h.connection
        .collection('user_access_projection')
        .findOne({ userId })
    ).status,
    'BLOCKED',
  );
  await assert.rejects(
    createPatient({ ...input, idempotencyKey: randomUUID() }),
    (e) => e.code === 'AUTH_PROJECTION_UNAVAILABLE',
  );
  await publishPatientOutboxBatch({
    connection: h.connection,
    channel: worker.channel,
  });
  const bad = await until(() => channel.get('dlq.patient.v1', { noAck: true }));
  assert.equal(bad.properties.messageId, forged.messageId);
  assert.equal(JSON.parse(bad.content).producer, 'browser');
  for (const rawBody of [Buffer.from([0xff, 0x80, 0x7b]), Buffer.alloc(0)]) {
    const rawId = randomUUID();
    channel.publish(
      'umc.events.identity.v1',
      'identity.identity-access-changed.v1',
      rawBody,
      { persistent: true, mandatory: true, messageId: rawId },
    );
    await channel.waitForConfirms();
    await until(() =>
      h.connection.collection('dead_letters').findOne({ messageId: rawId }),
    );
    await publishPatientOutboxBatch({
      connection: h.connection,
      channel: worker.channel,
    });
    const rejected = await until(() =>
      channel.get('dlq.patient.v1', { noAck: true }),
    );
    assert.equal(rejected.properties.messageId, rawId);
    assert.deepEqual(rejected.content, rawBody);
  }
  assert.equal(await h.connection.collection('patients').countDocuments({}), 1);
});
