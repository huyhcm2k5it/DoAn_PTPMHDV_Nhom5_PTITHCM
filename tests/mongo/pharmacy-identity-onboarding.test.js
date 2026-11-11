const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mongoHarness } = require('./test-harness');
const { ensurePharmacyStorage } = require('../../services/pharmacy/src/dbs/indexes');
const {
  dispatchMessage,
  startPharmacyWorker,
} = require('../../services/pharmacy/src/workers/amqp-runtime');
const { createAuthContext } = require('../../services/pharmacy/src/auth/auth.middleware');
const { staffAccess } = require('../../services/pharmacy/src/services/common');
const { receiveStock } = require('../../services/pharmacy/src/services/stock.service');

const h = mongoHarness(ensurePharmacyStorage);
const now = new Date('2026-11-11T00:00:00Z');
const exchange = 'umc.events.identity.v1';
const routingKey = 'identity.identity-access-changed.v1';

// Complete publish_access envelope; version is access_version, not tokenVersion.
function identityEvent(status, version = 2, userId = randomUUID(), actorType = 'PATIENT') {
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
    occurredAt: now.toISOString(),
    payload: {
      userId,
      status,
      actorType,
      capabilities: actorType === 'STAFF' ? ['PHARMACY'] : [],
      tokenVersion: 1,
      phoneVerified: status === 'ACTIVE',
      version,
    },
  };
}
function dispatch(message, route = {}) {
  return dispatchMessage({
    connection: h.connection,
    message,
    exchange,
    routingKey,
    now,
    ...route,
  });
}
async function authResult(message) {
  const auth = createAuthContext({
    connection: h.connection,
    verifyBearerToken: async () => ({
      sub: message.payload.userId,
      actorType: message.payload.actorType,
      capabilities: message.payload.capabilities,
      tokenVersion: 1,
    }),
  });
  const request = { get: () => 'Bearer locally-verified-token' };
  let error;
  await auth(request, {}, (value) => {
    error = value;
  });
  return { error, authContext: request.authContext };
}

// Only AMQP transport is substituted. The worker parses JSON, dispatches, runs
// transactions, persists quarantine failures and acknowledges real deliveries.
async function localWorker(t) {
  const callbacks = new Map();
  const acknowledged = [];
  const channel = {
    async assertQueue() {},
    async assertExchange() {},
    async bindQueue() {},
    async prefetch() {},
    async consume(queue, callback) {
      callbacks.set(queue, callback);
      return { consumerTag: queue };
    },
    ack(delivery) {
      acknowledged.push(delivery);
    },
    async cancel() {},
    async close() {},
  };
  const broker = {
    async createConfirmChannel() {
      return channel;
    },
    async close() {},
  };
  const worker = await startPharmacyWorker({
    connection: h.connection,
    connect: async () => broker,
    amqpUrl: 'amqp://local-test-transport',
    now: () => now,
  });
  t.after(() => worker.close());
  return async (message) => {
    const delivery = {
      content: Buffer.from(JSON.stringify(message)),
      fields: { exchange, routingKey },
      properties: { messageId: message.messageId },
    };
    await callbacks.get('evt.pharmacy.v1')(delivery);
    assert.ok(acknowledged.includes(delivery));
  };
}

for (const status of ['UNVERIFIED', 'PENDING_VERIFICATION']) {
  test(`worker accepts ${status} registration without quarantine or read access, then OTP ACTIVE grants access`, async (t) => {
    const deliver = await localWorker(t);
    const registration = identityEvent(status);
    await deliver(registration);
    assert.equal(await h.connection.collection('dead_letters').countDocuments({}), 0);
    assert.equal(await h.connection.collection('retry_jobs').countDocuments({}), 0);
    const projected = await h.connection
      .collection('user_access_projection')
      .findOne({ userId: registration.payload.userId });
    assert.equal(projected.status, status);
    assert.equal(projected.policyVersion, 2);
    assert.equal(projected.tokenVersion, 1);
    assert.equal((await authResult(registration)).error?.code, 'FORBIDDEN');
    await deliver(registration);
    assert.equal(
      await h.connection.collection('inbox').countDocuments({ consumer_name: 'pharmacy-access' }),
      1,
    );
    const verified = identityEvent('ACTIVE', 3, registration.payload.userId);
    await deliver(verified);
    const access = await authResult(verified);
    assert.equal(access.error, undefined);
    assert.equal(access.authContext.userId, registration.payload.userId);
    assert.equal(await h.connection.collection('dead_letters').countDocuments({}), 0);
  });
}

for (const status of ['UNVERIFIED', 'PENDING_VERIFICATION', 'BLOCKED']) {
  test(`${status} cannot authorize Pharmacy staff or mutate stock despite PHARMACY capability`, async () => {
    const message = identityEvent(status, 2, randomUUID(), 'STAFF');
    await dispatch(message);
    assert.equal((await authResult(message)).error?.code, 'FORBIDDEN');
    await assert.rejects(staffAccess(h.connection, message.payload.userId, undefined, 1), {
      code: 'FORBIDDEN',
    });
    await assert.rejects(
      receiveStock({
        connection: h.connection,
        principalId: message.payload.userId,
        tokenVersion: 1,
        idempotencyKey: randomUUID(),
        medicineId: randomUUID(),
        quantity: 1,
        now,
      }),
      { code: 'FORBIDDEN' },
    );
    for (const collection of [
      'inventory',
      'stock_receipts',
      'stock_audit',
      'idempotency_records',
    ]) {
      assert.equal(await h.connection.collection(collection).countDocuments({}), 0);
    }
  });
}

test('pending snapshots retain inbox conflicts, same-version conflicts and monotonic ACTIVE projection', async () => {
  const pending = identityEvent('UNVERIFIED');
  assert.deepEqual(await dispatch(pending), { duplicate: false });
  assert.deepEqual(await dispatch(pending), { duplicate: true });
  await assert.rejects(
    dispatch({ ...pending, payload: { ...pending.payload, capabilities: ['PHARMACY'] } }),
    { code: 'MESSAGE_CONFLICT' },
  );
  await assert.rejects(
    dispatch({
      ...pending,
      messageId: randomUUID(),
      payload: { ...pending.payload, status: 'ACTIVE' },
    }),
    { code: 'PROJECTION_CONFLICT' },
  );
  const active = identityEvent('ACTIVE', 3, pending.payload.userId);
  assert.deepEqual(await dispatch(active), { duplicate: false });
  for (const status of ['UNVERIFIED', 'PENDING_VERIFICATION']) {
    assert.deepEqual(await dispatch(identityEvent(status, 2, pending.payload.userId)), {
      duplicate: false,
    });
  }
  await assert.rejects(dispatch(identityEvent('PENDING_VERIFICATION', 3, pending.payload.userId)), {
    code: 'PROJECTION_CONFLICT',
  });
  const projected = await h.connection
    .collection('user_access_projection')
    .findOne({ userId: pending.payload.userId });
  assert.equal(projected.status, 'ACTIVE');
  assert.equal(projected.policyVersion, 3);
  assert.equal(projected.tokenVersion, 1);
  assert.equal((await authResult(active)).error, undefined);
  assert.equal(
    await h.connection.collection('inbox').countDocuments({ consumer_name: 'pharmacy-access' }),
    4,
  );
});

test('pending support preserves strict message routing, trusted producer, kind, schema and snapshot validation', async () => {
  const valid = identityEvent('UNVERIFIED');
  const invalid = [
    [{ ...valid, messageType: 'identityaccesschanged' }, {}],
    [{ ...valid, producer: 'browser' }, {}],
    [{ ...valid, producer: 'IDENTITY' }, {}],
    [{ ...valid, messageKind: 'COMMAND' }, {}],
    [{ ...valid, messageKind: 'event' }, {}],
    [{ ...valid, schemaVersion: 2 }, {}],
    [valid, { exchange: 'umc.events.patient.v1' }],
    [valid, { routingKey: 'identity.IdentityAccessChanged.v1' }],
    [{ ...valid, payload: { ...valid.payload, status: 'unverified' } }, {}],
    [{ ...valid, payload: { ...valid.payload, status: 'UNKNOWN' } }, {}],
    [{ ...valid, payload: { ...valid.payload, capabilities: [1] } }, {}],
    [{ ...valid, payload: { ...valid.payload, actorType: 'ADMIN' } }, {}],
    [{ ...valid, payload: { ...valid.payload, tokenVersion: 0 } }, {}],
    [{ ...valid, payload: { ...valid.payload, version: 0 } }, {}],
  ];
  for (const [message, route] of invalid) {
    await assert.rejects(dispatch(message, route), (error) => error.status === 400);
  }
  assert.equal(await h.connection.collection('user_access_projection').countDocuments({}), 0);
  assert.equal(await h.connection.collection('inbox').countDocuments({}), 0);
});
