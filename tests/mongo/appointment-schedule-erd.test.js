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
const authContext = { actorType: 'STAFF', capabilities: ['ADMIN'] };
const now = new Date('2026-11-21T01:00:00Z');
const doctorId = randomUUID();
const serviceId = randomUUID();

function create(fields = {}) {
  return createSchedule({
    connection: h.connection,
    authContext,
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
