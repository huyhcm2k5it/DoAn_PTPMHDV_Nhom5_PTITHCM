const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { mongoHarness } = require('./test-harness');
const {
  ensurePatientStorage,
} = require('../../services/patient/src/dbs/indexes');
const {
  getPatientModel,
} = require('../../services/patient/src/models/patient.model');
const {
  createPatient,
} = require('../../services/patient/src/services/manage-patient.service');
const {
  applyIdentityAccessChanged,
} = require('../../services/patient/src/services/identity-projection.service');
const {
  dispatchMessage,
  startPatientWorker,
} = require('../../services/patient/src/workers/amqp-runtime');
const {
  publishPatientOutboxBatch,
} = require('../../services/patient/src/workers/outbox-publisher.worker');
const h = mongoHarness(ensurePatientStorage, 'patient_db');
const userId = randomUUID();
function event(version = 1, status = 'UNVERIFIED') {
  return {
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
  };
}
function createArgs() {
  return {
    connection: h.connection,
    Patient: getPatientModel(h.connection),
    authContext: { userId, actorType: 'PATIENT', tokenVersion: 1 },
    body: {
      relation: 'SELF',
      fullName: 'DEMO Verified Patient',
      birthDate: '2000-01-02',
    },
    idempotencyKey: randomUUID(),
  };
}
test('Identity onboarding projects permissions before Patient mutation; unverified and blocked stay denied', async () => {
  await applyIdentityAccessChanged({
    connection: h.connection,
    message: event(1),
  });
  await assert.rejects(
    createPatient(createArgs()),
    (e) => e.code === 'AUTH_PROJECTION_UNAVAILABLE',
  );
  await applyIdentityAccessChanged({
    connection: h.connection,
    message: event(2, 'ACTIVE'),
  });
  const patient = await createPatient(createArgs());
  assert.equal(patient.ownerUserId, userId);
  assert.equal(
    await h.connection
      .collection('outbox')
      .countDocuments({ message_type: 'PatientAccessChanged' }),
    1,
  );
  await applyIdentityAccessChanged({
    connection: h.connection,
    message: event(3, 'BLOCKED'),
  });
  await assert.rejects(
    createPatient(createArgs()),
    (e) => e.code === 'AUTH_PROJECTION_UNAVAILABLE',
  );
});
test('projection replay, stale versions and conflicting message IDs cannot change current permissions', async () => {
  const active = event(3, 'ACTIVE');
  await applyIdentityAccessChanged({
    connection: h.connection,
    message: active,
  });
  assert.equal(
    (
      await applyIdentityAccessChanged({
        connection: h.connection,
        message: active,
      })
    ).duplicate,
    true,
  );
  await applyIdentityAccessChanged({
    connection: h.connection,
    message: event(2),
  });
  await assert.rejects(
    applyIdentityAccessChanged({
      connection: h.connection,
      message: { ...active, payload: { ...active.payload, status: 'BLOCKED' } },
    }),
    (e) => e.code === 'MESSAGE_CONFLICT',
  );
  const conflict = event(3, 'BLOCKED');
  await assert.rejects(
    applyIdentityAccessChanged({ connection: h.connection, message: conflict }),
    (e) => e.code === 'PROJECTION_CONFLICT',
  );
  assert.equal(
    await h.connection
      .collection('inbox')
      .countDocuments({ message_id: conflict.messageId }),
    0,
  );
  const row = await h.connection
    .collection('user_access_projection')
    .findOne({ userId });
  assert.equal(row.status, 'ACTIVE');
  assert.equal(row.policyVersion, 3);
  await assert.rejects(
    h.connection.collection('user_access_projection').insertOne({ userId }),
    (e) => e.code === 11000,
  );
});
test('Patient validates trusted exchange, producer, envelope, version and payload before projection', async () => {
  const valid = event(1, 'ACTIVE');
  const input = {
    connection: h.connection,
    message: valid,
    exchange: 'umc.events.identity.v1',
    routingKey: 'identity.identity-access-changed.v1',
  };
  for (const change of [
    { exchange: 'umc.events.pharmacy.v1' },
    { routingKey: 'identity.forged.v1' },
    { message: { ...valid, producer: 'browser' } },
    { message: { ...valid, messageId: [valid.messageId] } },
    { message: { ...valid, aggregateId: randomUUID() } },
    { message: { ...valid, aggregateVersion: 2 } },
    { message: { ...valid, payload: { ...valid.payload, tokenVersion: 0 } } },
    { message: { ...valid, payload: { ...valid.payload, status: 'UNKNOWN' } } },
    {
      message: {
        ...valid,
        payload: { ...valid.payload, phoneVerified: 'true' },
      },
    },
  ])
    await assert.rejects(
      dispatchMessage({ ...input, ...change }),
      (e) => e.code === 'INVALID_MESSAGE',
    );
  assert.equal(
    await h.connection.collection('user_access_projection').countDocuments({}),
    0,
  );
  await dispatchMessage(input);
  assert.equal(
    (
      await h.connection
        .collection('user_access_projection')
        .findOne({ userId })
    ).status,
    'ACTIVE',
  );
});
test('Patient worker ACKs durable projection/quarantine, publishes original bad body to DLQ, and leaves DB failures unacked', async (t) => {
  const callbacks = new Map();
  const acked = [];
  let brokerClosed = false;
  const channel = new EventEmitter();
  Object.assign(channel, {
    assertExchange: async () => {},
    assertQueue: async () => {},
    bindQueue: async () => {},
    prefetch: async () => {},
    consume: async (queue, cb) => {
      callbacks.set(queue, cb);
      return { consumerTag: queue };
    },
    cancel: async () => {},
    close: async () => {},
    ack: (d) => acked.push(d),
    publish: () => true,
    waitForConfirms: async () => {},
  });
  const broker = new EventEmitter();
  Object.assign(broker, {
    createConfirmChannel: async () => channel,
    close: async () => {
      brokerClosed = true;
    },
  });
  const worker = await startPatientWorker({
    connection: h.connection,
    amqpUrl: 'test://isolated',
    connect: async () => broker,
  });
  t.after(() => worker.close());
  const receive = callbacks.get('evt.patient.v1');
  assert.equal(typeof receive, 'function');
  const active = event(1, 'ACTIVE');
  const delivery = {
    content: Buffer.from(JSON.stringify(active)),
    fields: {
      exchange: 'umc.events.identity.v1',
      routingKey: 'identity.identity-access-changed.v1',
    },
    properties: { messageId: active.messageId },
  };
  await receive(delivery);
  assert.equal(acked.length, 1);
  assert.equal(
    (
      await h.connection
        .collection('user_access_projection')
        .findOne({ userId })
    ).status,
    'ACTIVE',
  );
  const bad = {
    ...delivery,
    content: Buffer.from('{invalid-json'),
    properties: { messageId: randomUUID() },
  };
  await receive(bad);
  assert.equal(acked.length, 2);
  assert.equal(
    await h.connection
      .collection('dead_letters')
      .countDocuments({ errorCode: 'INVALID_MESSAGE' }),
    1,
  );
  const sent = [];
  channel.publish = (...args) => {
    sent.push(args);
    return true;
  };
  await publishPatientOutboxBatch({ connection: h.connection, channel });
  assert.equal(sent[0][0], 'umc.deadletters.patient.v1');
  assert.equal(sent[0][1], 'patient.quarantine.v1');
  assert.equal(sent[0][2].toString(), bad.content.toString());
  assert.equal(sent[0][3].messageId, bad.properties.messageId);
  const transaction = h.connection.transaction;
  h.connection.transaction = async () => {
    throw new Error('simulated database unavailable');
  };
  try {
    await receive({
      ...delivery,
      content: Buffer.from(JSON.stringify(event(2, 'BLOCKED'))),
    });
  } finally {
    h.connection.transaction = transaction;
  }
  assert.equal(acked.length, 2);
  assert.equal(brokerClosed, true);
});

test('Patient worker exits after startup broker failure instead of leaving Mongo open', async () => {
  const { spawn } = require('node:child_process');
  const path = require('node:path');
  const uri =
    'mongodb://' +
    h.connection.host +
    ':' +
    h.connection.port +
    '/patient_db?replicaSet=' +
    h.connection.getClient().options.replicaSet;
  const child = spawn(
    process.execPath,
    [path.resolve(__dirname, '../../services/patient/scripts/worker.js')],
    {
      env: {
        ...process.env,
        MONGODB_URI: uri,
        AMQP_URL: 'amqp://test:test@127.0.0.1:1/isolated',
      },
      stdio: 'ignore',
    },
  );
  let timedOut = false;
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 4000);
    child.once('exit', (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  assert.equal(
    timedOut,
    false,
    'worker must release Mongo handles on failed broker startup',
  );
  assert.equal(code, 1);
});

test('Patient worker closes broker when the server cancels its consumer', async (t) => {
  let receive,
    closed = false;
  const channel = new EventEmitter();
  Object.assign(channel, {
    assertExchange: async () => {},
    assertQueue: async () => {},
    bindQueue: async () => {},
    prefetch: async () => {},
    consume: async (_queue, callback) => {
      receive = callback;
      return { consumerTag: 'cancel-test' };
    },
    cancel: async () => {},
    close: async () => {},
  });
  const broker = new EventEmitter();
  Object.assign(broker, {
    createConfirmChannel: async () => channel,
    close: async () => {
      closed = true;
    },
  });
  const worker = await startPatientWorker({
    connection: h.connection,
    amqpUrl: 'test://isolated',
    connect: async () => broker,
  });
  t.after(() => worker.close());
  await receive(null);
  assert.equal(
    closed,
    true,
    'cancelled consumer must trigger process restart instead of silently stalling',
  );
});

test('parallel first deliveries remain unique and higher permission versions win', async () => {
  const first = event(1);
  await Promise.all(
    Array.from({ length: 8 }, () =>
      applyIdentityAccessChanged({ connection: h.connection, message: first }),
    ),
  );
  assert.equal(
    await h.connection
      .collection('inbox')
      .countDocuments({ message_id: first.messageId }),
    1,
  );
  await Promise.all(
    [
      event(4, 'LOCKED'),
      event(2, 'ACTIVE'),
      event(5, 'BLOCKED'),
      event(3, 'ACTIVE'),
    ].map((message) =>
      applyIdentityAccessChanged({ connection: h.connection, message }),
    ),
  );
  const rows = await h.connection
    .collection('user_access_projection')
    .find({ userId })
    .toArray();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].policyVersion, 5);
  assert.equal(rows[0].status, 'BLOCKED');
});

test('quarantine uses a valid broker ID or body hash when the untrusted JSON ID is malformed', async () => {
  const { persistDeliveryFailure } = require('../../mongo/durable-retry');
  for (const badId of [[randomUUID()], { forged: true }, 'x'.repeat(300)]) {
    const brokerId = randomUUID();
    const delivery = {
      content: Buffer.from(JSON.stringify({ messageId: badId })),
      properties: { messageId: brokerId },
      fields: {
        exchange: 'umc.events.identity.v1',
        routingKey: 'identity.identity-access-changed.v1',
      },
    };
    await persistDeliveryFailure({
      connection: h.connection,
      delivery,
      consumerName: 'patient',
      error: { status: 400, code: 'INVALID_MESSAGE' },
    });
    const row = await h.connection
      .collection('dead_letters')
      .findOne({ messageId: brokerId });
    assert.ok(
      row,
      'invalid JSON IDs must not poison AMQP messageId when publishing quarantine',
    );
    assert.equal(typeof row.messageId, 'string');
  }
  const content = Buffer.from(JSON.stringify({ messageId: null }));
  await persistDeliveryFailure({
    connection: h.connection,
    delivery: { content, properties: { messageId: ['invalid'] }, fields: {} },
    consumerName: 'patient',
    error: { status: 400, code: 'INVALID_MESSAGE' },
  });
  const expected = require('node:crypto')
    .createHash('sha256')
    .update(content)
    .digest('hex');
  assert.equal(
    await h.connection
      .collection('dead_letters')
      .countDocuments({ messageId: expected }),
    1,
  );
});
