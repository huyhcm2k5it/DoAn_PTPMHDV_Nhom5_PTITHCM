const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { ensureAppointmentStorage } = require('../../services/appointment/src/dbs/indexes.js');
const {
  getScheduleModel,
  getSlotModel,
} = require('../../services/appointment/src/models/appointment.model.js');
const { createApp: createAppointmentApp } = require('../../services/appointment/src/app.js');
const {
  createHold,
  releaseHold,
  expireHolds,
} = require('../../services/appointment/src/services/holds.service.js');
const {
  handleBillingMessage,
} = require('../../services/appointment/src/workers/billing-events.worker.js');
const {
  publishOutboxBatch,
} = require('../../services/appointment/src/workers/outbox-publisher.worker.js');
const {
  expirePendingAppointments,
} = require('../../services/appointment/src/workers/appointment-expiry.worker.js');

const ownerA = '11111111-1111-4111-8111-111111111111';
const patientA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const patientB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const doctor = '33333333-3333-4333-8333-333333333333';
const service = '44444444-4444-4444-8444-444444444444';

async function listen(app, t) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  return 'http://127.0.0.1:' + server.address().port;
}

async function setup(t) {
  const mongod = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: '8.0.16' },
  });
  const connection = await mongoose
    .createConnection(mongod.getUri(), {
      dbName: 'appointment_db',
      autoCreate: false,
      autoIndex: false,
    })
    .asPromise();
  t.after(async () => {
    await connection.close();
    await mongod.stop();
  });
  await ensureAppointmentStorage(connection);
  const Schedule = getScheduleModel(connection);
  const Slot = getSlotModel(connection);
  await Schedule.create({
    id: 'schedule-1',
    doctorId: doctor,
    serviceId: service,
    startAt: new Date('2026-10-31T01:00:00Z'),
    endAt: new Date('2026-10-31T02:00:00Z'),
    status: 'OPEN',
  });
  await Slot.create({
    id: 'slot-1',
    scheduleId: 'schedule-1',
    startAt: new Date('2026-10-31T01:00:00Z'),
    endAt: new Date('2026-10-31T01:30:00Z'),
    capacity: 1,
    heldCount: 0,
    confirmedCount: 0,
  });
  const verifyBearerToken = async (token) =>
    token === 'a' ? { sub: ownerA, actorType: 'PATIENT' } : null;
  const authorizePatientAccess = async ({ authContext, patientId }) =>
    authContext.userId === ownerA && patientId === patientA;
  const base = await listen(
    createAppointmentApp({
      connection,
      verifyBearerToken,
      authorizePatientAccess,
      now: () => new Date('2026-10-31T00:00:00Z'),
      resolvePriceSnapshot: async () => ({
        priceVersionId: 'price-1',
        amountVnd: 100000,
        currency: 'VND',
        pricingAt: '2026-10-30T00:00:00.000Z',
        expiresAt: '2026-11-01T00:00:00.000Z',
        snapshotHash: 'hash-1',
      }),
    }),
    t,
  );
  return { connection, Schedule, Slot, base };
}

test('AP-008 reserves the last slot once and AP-009 releases it', async (t) => {
  const { Slot, base } = await setup(t);
  const hold = await fetch(base + '/api/v1/appointment-holds', {
    method: 'POST',
    headers: {
      authorization: 'Bearer a',
      'content-type': 'application/json',
      'idempotency-key': '11111111-1111-4111-8111-111111111111',
    },
    body: JSON.stringify({ patientId: patientA, slotId: 'slot-1' }),
  });
  assert.equal(hold.status, 201);
  const payload = await hold.json();
  assert.equal(payload.data.state, 'HELD');
  assert.equal((await Slot.findOne({ id: 'slot-1' })).heldCount, 1);

  const replay = await fetch(base + '/api/v1/appointment-holds', {
    method: 'POST',
    headers: {
      authorization: 'Bearer a',
      'content-type': 'application/json',
      'idempotency-key': '11111111-1111-4111-8111-111111111111',
    },
    body: JSON.stringify({ patientId: patientA, slotId: 'slot-1' }),
  });
  assert.equal(replay.status, 201);
  assert.equal((await replay.json()).data.holdId, payload.data.holdId);
  const changedBody = await fetch(base + '/api/v1/appointment-holds', {
    method: 'POST',
    headers: {
      authorization: 'Bearer a',
      'content-type': 'application/json',
      'idempotency-key': '11111111-1111-4111-8111-111111111111',
    },
    body: JSON.stringify({ patientId: patientA, slotId: 'slot-other' }),
  });
  assert.equal(changedBody.status, 409);

  const conflict = await fetch(base + '/api/v1/appointment-holds', {
    method: 'POST',
    headers: {
      authorization: 'Bearer a',
      'content-type': 'application/json',
      'idempotency-key': '22222222-2222-4222-8222-222222222222',
    },
    body: JSON.stringify({ patientId: patientA, slotId: 'slot-1' }),
  });
  assert.equal(conflict.status, 409);

  const release = await fetch(base + '/api/v1/appointment-holds/' + payload.data.holdId, {
    method: 'DELETE',
    headers: {
      authorization: 'Bearer a',
      'idempotency-key': '33333333-3333-4333-8333-333333333333',
    },
  });
  assert.equal(release.status, 200);
  assert.equal((await Slot.findOne({ id: 'slot-1' })).heldCount, 0);
});

test('AP-010 consumes a hold into PENDING_PAYMENT and AP-011/AP-012 read it', async (t) => {
  const { connection, base } = await setup(t);
  const created = await createHold({
    connection,
    patientId: patientA,
    slotId: 'slot-1',
    principalId: ownerA,
    idempotencyKey: '44444444-4444-4444-8444-444444444444',
    now: new Date('2026-10-31T00:00:00Z'),
    resolvePriceSnapshot: async () => ({
      priceVersionId: 'price-1',
      amountVnd: 100000,
      currency: 'VND',
      pricingAt: '2026-10-30T00:00:00.000Z',
      expiresAt: '2026-11-01T00:00:00.000Z',
      snapshotHash: 'hash-1',
    }),
  });
  const appointment = await fetch(base + '/api/v1/appointments', {
    method: 'POST',
    headers: {
      authorization: 'Bearer a',
      'content-type': 'application/json',
      'idempotency-key': '55555555-5555-4555-8555-555555555555',
    },
    body: JSON.stringify({ holdId: created.holdId, patientId: patientA }),
  });
  assert.equal(appointment.status, 202);
  const accepted = await appointment.json();
  assert.equal(accepted.data.state, 'PENDING_PAYMENT');
  const appointmentReplay = await fetch(base + '/api/v1/appointments', {
    method: 'POST',
    headers: {
      authorization: 'Bearer a',
      'content-type': 'application/json',
      'idempotency-key': '55555555-5555-4555-8555-555555555555',
    },
    body: JSON.stringify({ holdId: created.holdId, patientId: patientA }),
  });
  assert.equal(appointmentReplay.status, 202);
  assert.equal((await appointmentReplay.json()).data.appointmentId, accepted.data.appointmentId);
  const detail = await (
    await fetch(base + '/api/v1/appointments/' + accepted.data.appointmentId, {
      headers: { authorization: 'Bearer a' },
    })
  ).json();
  assert.equal(detail.data.appointment.state, 'PENDING_PAYMENT');
  assert.equal(detail.data.appointment.chargeSync, 'PENDING');
  const list = await (
    await fetch(base + '/api/v1/patients/' + patientA + '/appointments', {
      headers: { authorization: 'Bearer a' },
    })
  ).json();
  assert.equal(list.data.total, 1);
  assert.equal(
    await connection.collection('outbox').countDocuments({ message_type: 'RequestCharge' }),
    1,
  );
});

test('expired holds return capacity exactly once', async (t) => {
  const { connection, Slot } = await setup(t);
  const created = await createHold({
    connection,
    patientId: patientA,
    slotId: 'slot-1',
    principalId: ownerA,
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    now: new Date('2026-10-31T00:00:00Z'),
    resolvePriceSnapshot: async () => ({
      priceVersionId: 'price-1',
      amountVnd: 100000,
      currency: 'VND',
      snapshotHash: 'hash-1',
    }),
  });
  assert.equal((await Slot.findOne({ id: 'slot-1' })).heldCount, 1);
  const first = await expireHolds({
    connection,
    now: new Date('2026-10-31T00:11:00Z'),
    batchSize: 10,
  });
  const second = await expireHolds({
    connection,
    now: new Date('2026-10-31T00:12:00Z'),
    batchSize: 10,
  });
  assert.equal(first, 1);
  assert.equal(second, 0);
  assert.equal((await Slot.findOne({ id: 'slot-1' })).heldCount, 0);
});

test('hold fails closed when Catalog price projection is unavailable', async (t) => {
  const { connection, Slot } = await setup(t);
  await assert.rejects(
    createHold({
      connection,
      patientId: patientA,
      slotId: 'slot-1',
      principalId: ownerA,
      idempotencyKey: '66666666-6666-4666-8666-666666666667',
      now: new Date('2026-10-31T00:00:00Z'),
      resolvePriceSnapshot: async () => null,
    }),
    (error) => error.code === 'PRICE_PROJECTION_STALE' && error.status === 503,
  );
  assert.equal((await Slot.findOne({ id: 'slot-1' })).heldCount, 0);
});

test('patient overlap lock rejects a second overlapping slot but allows adjacent time', async (t) => {
  const { connection, Schedule, Slot } = await setup(t);
  await Schedule.create({
    id: 'schedule-2',
    doctorId: doctor,
    serviceId: service,
    startAt: new Date('2026-10-31T02:00:00Z'),
    endAt: new Date('2026-10-31T03:00:00Z'),
    status: 'OPEN',
  });
  await Slot.create({
    id: 'slot-2',
    scheduleId: 'schedule-2',
    startAt: new Date('2026-10-31T02:00:00Z'),
    endAt: new Date('2026-10-31T02:30:00Z'),
    capacity: 1,
    heldCount: 0,
    confirmedCount: 0,
  });
  const price = async () => ({
    priceVersionId: 'price-1',
    amountVnd: 100000,
    currency: 'VND',
    snapshotHash: 'hash-1',
  });
  await createHold({
    connection,
    patientId: patientA,
    slotId: 'slot-1',
    principalId: ownerA,
    idempotencyKey: '66666666-6666-4666-8666-666666666668',
    now: new Date('2026-10-31T00:00:00Z'),
    resolvePriceSnapshot: price,
  });
  await assert.rejects(
    createHold({
      connection,
      patientId: patientA,
      slotId: 'slot-1',
      principalId: ownerA,
      idempotencyKey: '66666666-6666-4666-8666-666666666669',
      now: new Date('2026-10-31T00:00:00Z'),
      resolvePriceSnapshot: price,
    }),
    (error) => error.code === 'PATIENT_TIME_CONFLICT',
  );
  await assert.doesNotReject(
    createHold({
      connection,
      patientId: patientA,
      slotId: 'slot-2',
      principalId: ownerA,
      idempotencyKey: '66666666-6666-4666-8666-666666666670',
      now: new Date('2026-10-31T00:00:00Z'),
      resolvePriceSnapshot: price,
    }),
  );
});

test('Billing messages require matching source and fence before CONFIRMED', async (t) => {
  const { connection, base } = await setup(t);
  const created = await createHold({
    connection,
    patientId: patientA,
    slotId: 'slot-1',
    principalId: ownerA,
    idempotencyKey: '77777777-7777-4777-8777-777777777777',
    now: new Date('2026-10-31T00:00:00Z'),
    resolvePriceSnapshot: async () => ({
      priceVersionId: 'price-1',
      amountVnd: 100000,
      currency: 'VND',
      snapshotHash: 'hash-1',
    }),
  });
  const response = await fetch(base + '/api/v1/appointments', {
    method: 'POST',
    headers: {
      authorization: 'Bearer a',
      'content-type': 'application/json',
      'idempotency-key': '88888888-8888-4888-8888-888888888888',
    },
    body: JSON.stringify({ holdId: created.holdId, patientId: patientA }),
  });
  const appointmentId = (await response.json()).data.appointmentId;
  const source = { sourceType: 'APPOINTMENT', sourceId: appointmentId, sourceRevision: 1 };
  assert.deepEqual(
    await handleBillingMessage({
      connection,
      message: {
        messageId: 'msg-charge',
        messageType: 'ChargePrepared',
        payload: { ...source, state: 'CREATED', chargeId: 'charge-1' },
      },
    }),
    { duplicate: false },
  );
  assert.deepEqual(
    await handleBillingMessage({
      connection,
      message: {
        messageId: 'msg-reserve',
        messageType: 'SettlementReserved',
        payload: { ...source, state: 'ACCEPTED', settlementId: 'settlement-1', fence: 1 },
      },
    }),
    { duplicate: false },
  );
  await assert.rejects(
    handleBillingMessage({
      connection,
      message: {
        messageId: 'msg-paid-bad',
        messageType: 'ChargePaid',
        payload: {
          ...source,
          chargeId: 'charge-1',
          settlementId: 'settlement-1',
          fence: 2,
          amountVnd: 100000,
        },
      },
    }),
    (error) => error.code === 'SETTLEMENT_MISMATCH',
  );
  assert.deepEqual(
    await handleBillingMessage({
      connection,
      message: {
        messageId: 'msg-paid',
        messageType: 'ChargePaid',
        payload: {
          ...source,
          chargeId: 'charge-1',
          settlementId: 'settlement-1',
          fence: 1,
          amountVnd: 100000,
        },
      },
    }),
    { duplicate: false },
  );
  assert.deepEqual(
    await handleBillingMessage({
      connection,
      message: {
        messageId: 'msg-paid',
        messageType: 'ChargePaid',
        payload: {
          ...source,
          chargeId: 'charge-1',
          settlementId: 'settlement-1',
          fence: 1,
          amountVnd: 100000,
        },
      },
    }),
    { duplicate: true },
  );
  const row = await connection.collection('appointments').findOne({ id: appointmentId });
  assert.equal(row.state, 'CONFIRMED');
});

test('pending payment expiry releases capacity once and emits AppointmentChanged', async (t) => {
  const { connection, Slot, base } = await setup(t);
  const created = await createHold({
    connection,
    patientId: patientA,
    slotId: 'slot-1',
    principalId: ownerA,
    idempotencyKey: '77777777-7777-4777-8777-777777777778',
    now: new Date('2026-10-31T00:00:00Z'),
    resolvePriceSnapshot: async () => ({
      priceVersionId: 'price-1',
      amountVnd: 100000,
      currency: 'VND',
      snapshotHash: 'hash-1',
    }),
  });
  const response = await fetch(base + '/api/v1/appointments', {
    method: 'POST',
    headers: {
      authorization: 'Bearer a',
      'content-type': 'application/json',
      'idempotency-key': '88888888-8888-4888-8888-888888888889',
    },
    body: JSON.stringify({ holdId: created.holdId, patientId: patientA }),
  });
  const appointmentId = (await response.json()).data.appointmentId;
  assert.equal(
    await expirePendingAppointments({ connection, now: new Date('2026-10-31T00:11:00Z') }),
    1,
  );
  assert.equal(
    await expirePendingAppointments({ connection, now: new Date('2026-10-31T00:12:00Z') }),
    0,
  );
  assert.equal(
    (await connection.collection('appointments').findOne({ id: appointmentId })).state,
    'EXPIRED',
  );
  assert.equal((await Slot.findOne({ id: 'slot-1' })).heldCount, 0);
  assert.equal(
    await connection.collection('outbox').countDocuments({ message_type: 'AppointmentChanged' }),
    1,
  );
});

test('outbox publisher marks RequestCharge only after confirm', async (t) => {
  const { connection, base } = await setup(t);
  const created = await createHold({
    connection,
    patientId: patientA,
    slotId: 'slot-1',
    principalId: ownerA,
    idempotencyKey: '99999999-9999-4999-8999-999999999999',
    now: new Date('2026-10-31T00:00:00Z'),
    resolvePriceSnapshot: async () => ({
      priceVersionId: 'price-1',
      amountVnd: 100000,
      currency: 'VND',
      snapshotHash: 'hash-1',
    }),
  });
  await fetch(base + '/api/v1/appointments', {
    method: 'POST',
    headers: {
      authorization: 'Bearer a',
      'content-type': 'application/json',
      'idempotency-key': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    body: JSON.stringify({ holdId: created.holdId, patientId: patientA }),
  });
  const published = [];
  const channel = {
    async assertExchange() {},
    publish(exchange, routingKey, body, options) {
      published.push({ exchange, routingKey, body: JSON.parse(body), options });
      return true;
    },
    async waitForConfirms() {},
  };
  assert.equal(
    await publishOutboxBatch({ connection, channel, now: new Date('2026-10-31T00:01:00Z') }),
    1,
  );
  assert.equal(published[0].routingKey, 'billing.request-charge.v1');
  assert.ok(
    (await connection.collection('outbox').findOne({ message_type: 'RequestCharge' })).published_at,
  );
});
