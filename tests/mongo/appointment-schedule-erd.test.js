const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mongoHarness } = require('./test-harness');
const { ensureAppointmentStorage } = require('../../services/appointment/src/dbs/indexes');
const {
  createSchedule,
  updateSchedule,
} = require('../../services/appointment/src/services/schedules.service');

const { createHold } = require('../../services/appointment/src/services/holds.service');

const h = mongoHarness(ensureAppointmentStorage, 'appointment_db');
const authContext = { userId: randomUUID(), actorType: 'STAFF', capabilities: ['ADMIN'] };
const now = new Date('2026-11-21T01:00:00Z');
const doctorId = randomUUID();
const serviceId = randomUUID();

function create(fields = {}) {
  return createSchedule({
    connection: h.connection,
    authContext,
    idempotencyKey: randomUUID(),
    now,
    body: {
      doctorId,
      serviceId,
      room: 'A-101',
      startAt: '2026-11-22T01:00:00Z',
      endAt: '2026-11-22T02:00:00Z',
      capacityPerSlot: 3,
      slotMinutes: 30,
      ...fields,
    },
  });
}

function update(schedule, fields) {
  return updateSchedule({
    connection: h.connection,
    authContext,
    idempotencyKey: randomUUID(),
    now,
    scheduleId: schedule.id,
    body: { expectedVersion: schedule.version, ...fields },
  });
}

function slots(schedule) {
  return h.connection
    .collection('slots')
    .find({ scheduleId: schedule.id })
    .sort({ startAt: 1 })
    .toArray();
}

test('bootstrap enforces settlement decision uniqueness with Mongoose autoIndex disabled', async () => {
  const decisions = h.connection.collection('settlement_decisions');
  const row = {
    settlementId: randomUUID(),
    sourceId: randomUUID(),
    decisionVersion: 1,
  };
  assert.equal(h.connection.config.autoIndex, false);
  const index = (await decisions.indexes()).find(
    (item) => item.name === 'uq_settlement_decision_version',
  );
  assert.deepEqual(index.key, { settlementId: 1, decisionVersion: 1 });
  assert.equal(index.unique, true);
  await decisions.insertOne({ ...row });
  await assert.rejects(decisions.insertOne({ ...row, sourceId: randomUUID() }), { code: 11000 });
  await decisions.insertOne({ ...row, decisionVersion: 2 });
});

test('concurrent schedules for the same room allow one winner and permit an adjacent window', async () => {
  const attempts = await Promise.allSettled([
    create(),
    create({ doctorId: randomUUID(), room: 'a-101' }),
  ]);
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = attempts.find((item) => item.status === 'rejected');
  assert.equal(rejected.reason.code, 'SCHEDULE_OVERLAP');
  assert.equal(await h.connection.collection('schedules').countDocuments(), 1);
  assert.equal(await h.connection.collection('slots').countDocuments(), 2);
  await create({
    doctorId: randomUUID(),
    startAt: '2026-11-22T02:00:00Z',
    endAt: '2026-11-22T03:00:00Z',
  });
});

test('overlap checks both doctor and room when creating or updating a schedule', async () => {
  await create();
  await assert.rejects(create({ room: 'B-101' }), {
    code: 'SCHEDULE_OVERLAP',
  });
  const other = await create({ doctorId: randomUUID(), room: 'B-101' });
  await assert.rejects(update(other.schedule, { room: ' A-101 ' }), {
    code: 'SCHEDULE_OVERLAP',
  });
  assert.equal(
    (await h.connection.collection('schedules').findOne({ id: other.schedule.id })).room,
    'B-101',
  );
});

test('slot capacity changes compare each slot and preserve booked IDs', async () => {
  const original = await create();
  await h.connection
    .collection('slots')
    .updateMany({ scheduleId: original.schedule.id }, { $set: { heldCount: 2 } });
  const next = await update(original.schedule, { capacityPerSlot: 2 });
  const saved = await slots(next);
  assert.deepEqual(
    saved.map((item) => [item.id, item.capacity, item.heldCount, item.version]),
    original.slots.map((item) => [item.id, 2, 2, 2]),
  );
  await assert.rejects(update(next, { capacityPerSlot: 1 }), {
    code: 'BOOKED_CAPACITY_CONFLICT',
  });
  await assert.rejects(update(original.schedule, { capacityPerSlot: 3 }), {
    code: 'SCHEDULE_VERSION_CONFLICT',
  });
  assert.deepEqual(await slots(next), saved);
});

test('regenerates changed slots and preserves IDs for unchanged intervals', async () => {
  const original = await create();
  const extended = await update(original.schedule, {
    endAt: '2026-11-22T02:15:00Z',
  });
  const ids = (await slots(extended)).map((item) => item.id);
  assert.deepEqual(
    ids.slice(0, 2),
    original.slots.map((item) => item.id),
  );
  assert.equal(ids.length, 3);
  const resized = await update(extended, { slotMinutes: 45 });
  const saved = await slots(resized);
  assert.deepEqual(
    saved.map((item) => [item.startAt.toISOString(), item.endAt.toISOString()]),
    [
      ['2026-11-22T01:00:00.000Z', '2026-11-22T01:45:00.000Z'],
      ['2026-11-22T01:45:00.000Z', '2026-11-22T02:15:00.000Z'],
    ],
  );
  assert.ok(saved.every((item) => !ids.includes(item.id)));
  await assert.rejects(update(resized, { endAt: '2026-11-22T00:30:00Z' }), {
    code: 'VALIDATION_ERROR',
  });
  assert.deepEqual(await slots(resized), saved);
});

test('moving an occupied slot or removing a slot referenced by history leaves all data intact', async () => {
  const original = await create();
  const coll = h.connection.collection('slots');
  await coll.updateOne({ id: original.slots[0].id }, { $set: { confirmedCount: 1 } });
  await assert.rejects(update(original.schedule, { slotMinutes: 15 }), {
    code: 'BOOKED_CAPACITY_CONFLICT',
  });
  await coll.updateOne({ id: original.slots[0].id }, { $set: { confirmedCount: 0 } });
  await h.connection.collection('holds').insertOne({
    id: randomUUID(),
    patientId: randomUUID(),
    principalId: randomUUID(),
    idempotencyKey: randomUUID(),
    slotId: original.slots[0].id,
    expiresAt: now,
    status: 'EXPIRED',
  });
  const before = await slots(original.schedule);
  await assert.rejects(update(original.schedule, { slotMinutes: 15 }), {
    code: 'BOOKED_CAPACITY_CONFLICT',
  });
  assert.deepEqual(await slots(original.schedule), before);
  const stored = await h.connection.collection('schedules').findOne({ id: original.schedule.id });
  assert.equal(stored.version, original.schedule.version);
  assert.equal(stored.slotMinutes, 30);
});

test('capacity reduction and a concurrent hold cannot produce an overbooked slot', async () => {
  const original = await create({
    doctorUserId: randomUUID(),
    departmentId: randomUUID(),
  });
  const slot = original.slots[0];
  const coll = h.connection.collection('slots');
  await coll.updateOne({ id: slot.id }, { $set: { heldCount: 1 } });

  let signalReserved;
  const reserved = new Promise((resolve) => {
    signalReserved = resolve;
  });
  let releasePrice;
  const priceReady = new Promise((resolve) => {
    releasePrice = resolve;
  });
  const hold = createHold({
    connection: h.connection,
    patientId: randomUUID(),
    principalId: randomUUID(),
    idempotencyKey: randomUUID(),
    slotId: slot.id,
    now,
    resolvePriceSnapshot: async () => {
      signalReserved();
      await priceReady;
      return { amountVnd: 100000, snapshotHash: 'sample-hash' };
    },
  });

  const reduce = reserved.then(() => {
    const change = update(original.schedule, { capacityPerSlot: 1 });
    releasePrice();
    return change;
  });
  const [held, changed] = await Promise.allSettled([hold, reduce]);
  assert.equal(held.status, 'fulfilled');
  assert.equal(changed.status, 'rejected');
  assert.equal(changed.reason.code, 'BOOKED_CAPACITY_CONFLICT');
  const saved = await coll.findOne({ id: slot.id });
  assert.equal(saved.heldCount, 2);
  assert.equal(saved.capacity, 3);
});

test('existing duplicate decisions are reported without deleting or rewriting either row', async () => {
  const legacy = h.connection.useDb('appointment_legacy_test');
  try {
    const decisions = legacy.collection('settlement_decisions');
    const settlementId = randomUUID();
    await decisions.insertMany([
      { settlementId, decisionVersion: 1, state: 'FAILED' },
      { settlementId, decisionVersion: 1, state: 'UNKNOWN' },
    ]);
    await assert.rejects(ensureAppointmentStorage(legacy), { code: 11000 });
    assert.equal(await decisions.countDocuments({ settlementId }), 2);
  } finally {
    await legacy.dropDatabase();
  }
});

test('two overlapping slots for the same patient allow only one concurrent hold', async () => {
  const mapping = { doctorUserId: randomUUID(), departmentId: randomUUID() };
  const a = await create(mapping);
  const b = await create({ ...mapping, doctorId: randomUUID(), room: 'B-101' });
  const patientId = randomUUID();
  const principalId = randomUUID();
  const attempt = (slot) =>
    createHold({
      connection: h.connection,
      patientId,
      principalId,
      slotId: slot.id,
      now,
      idempotencyKey: randomUUID(),
      resolvePriceSnapshot: async () => ({ amountVnd: 100000, snapshotHash: 'sample-hash' }),
    });
  const results = await Promise.allSettled([attempt(a.slots[0]), attempt(b.slots[0])]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = results.find((item) => item.status === 'rejected');
  assert.equal(rejected.reason.code, 'PATIENT_TIME_CONFLICT');
  assert.equal(await h.connection.collection('holds').countDocuments({ patientId }), 1);
});

test('schedule HTTP writes validate the schema and replay the original intent', async (t) => {
  const { createApp } = require('../../services/appointment/src/app');
  const Ajv = require('ajv/dist/2020');
  const addFormats = require('ajv-formats');
  const contract = require('../../contracts/http/appointment.openapi.json');
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile({
    ...contract,
    $ref: '#/components/schemas/ScheduleResponse',
  });
  const app = createApp({
    connection: h.connection,
    now: () => now,
    verifyBearerToken: async () => ({
      sub: authContext.userId,
      actorType: 'STAFF',
      capabilities: ['ADMIN'],
      tokenVersion: 1,
    }),
    verifyAuthorizationLease: async (_, options) => ({
      tokenType: 'LEASE',
      sub: options.subject,
      action: options.action,
      tokenVersion: options.tokenVersion,
      iat: +now / 1000,
      exp: +now / 1000 + 30,
    }),
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v1/schedules';
  async function call(method, body, key, scheduleId) {
    const res = await fetch(scheduleId ? base + '/' + scheduleId : base, {
      method,
      headers: {
        authorization: 'Bearer test',
        'x-authorization-lease': 'test',
        'content-type': 'application/json',
        ...(key ? { 'idempotency-key': key } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }
  const input = {
    doctorId,
    serviceId,
    room: 'Box 1',
    startAt: '2026-11-22T01:00:00Z',
    endAt: '2026-11-22T02:00:00Z',
    slotMinutes: 15,
    capacityPerSlot: 3,
  };
  const key = randomUUID();
  assert.equal((await call('POST', input)).status, 400);
  assert.equal((await call('POST', { ...input, room: ' ' }, key)).status, 400);
  const results = await Promise.all([call('POST', input, key), call('POST', input, key)]);
  for (const created of results) {
    assert.equal(created.status, 201);
    assert.equal(validate(created.body), true, JSON.stringify(validate.errors));
  }
  assert.deepEqual(results[0].body.data, results[1].body.data);
  const id = results[0].body.data.schedule.id;
  assert.equal(await h.connection.collection('schedules').countDocuments(), 1);
  assert.equal(await h.connection.collection('slots').countDocuments(), 4);
  const reused = await call('POST', { ...input, room: 'Box 2' }, key);
  assert.equal(reused.status, 409);
  assert.equal(reused.body.error.code, 'IDEMPOTENCY_KEY_REUSED');

  const patch = { expectedVersion: 1, capacityPerSlot: 2 };
  assert.equal((await call('PATCH', patch, undefined, id)).status, 400);
  const patchKey = randomUUID();
  const modified = await call('PATCH', patch, patchKey, id);
  assert.equal(modified.status, 200);
  assert.equal(validate(modified.body), true, JSON.stringify(validate.errors));
  assert.equal(modified.body.data.schedule.version, 2);
  assert.deepEqual((await call('PATCH', patch, patchKey, id)).body.data, modified.body.data);
  const changed = await call('PATCH', { ...patch, capacityPerSlot: 1 }, patchKey, id);
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await h.connection.collection('schedules').findOne({ id })).version, 2);
});
