const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { ensurePatientStorage } = require('../../services/patient/src/dbs/indexes.js');
const { getPatientModel } = require('../../services/patient/src/models/patient.model.js');
const { createApp: createPatientApp } = require('../../services/patient/src/app.js');
const { ensureAppointmentStorage } = require('../../services/appointment/src/dbs/indexes.js');
const { getScheduleModel, getSlotModel } = require('../../services/appointment/src/models/appointment.model.js');
const { createApp: createAppointmentApp } = require('../../services/appointment/src/app.js');
const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const patientA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const doctor = '33333333-3333-4333-8333-333333333333';
const service = '44444444-4444-4444-8444-444444444444';
const tokenClaims = { ownerA: { sub: ownerA, actorType: 'PATIENT' }, ownerB: { sub: ownerB, actorType: 'PATIENT' } };
async function listen(app, t) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  return 'http://127.0.0.1:' + server.address().port;
}
test('Patient read APIs scope by verified identity and ignore X-User-Id', async (t) => {
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '8.0.16' } });
  const connection = await mongoose.createConnection(mongod.getUri(), { dbName: 'patient_db', autoCreate: false, autoIndex: false }).asPromise();
  t.after(async () => { await connection.close(); await mongod.stop(); });
  await ensurePatientStorage(connection);
  const Patient = getPatientModel(connection);
  await Patient.create([
    { id: patientA, ownerUserId: ownerA, relation: 'SELF', fullName: 'Minh An', birthDate: '1998-01-01', active: true, createdAt: new Date('2026-01-01T00:00:00Z') },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ownerUserId: ownerB, relation: 'SELF', fullName: 'Other', birthDate: '1995-02-02', active: true, createdAt: new Date('2026-01-02T00:00:00Z') },
  ]);
  const base = await listen(createPatientApp({ connection, verifyBearerToken: async (token) => tokenClaims[token] }), t);
  const list = await fetch(base + '/api/v1/patients?page=1&limit=20', { headers: { authorization: 'Bearer ownerA', 'x-user-id': ownerB, 'x-correlation-id': 'week1-test' } });
  assert.equal(list.status, 200);
  const payload = await list.json();
  assert.equal(payload.data.total, 1);
  assert.equal(payload.data.items[0].id, patientA);
  assert.equal(payload.meta.correlationId, 'week1-test');
  const crossOwner = await fetch(base + '/api/v1/patients/' + patientA, { headers: { authorization: 'Bearer ownerB' } });
  assert.equal(crossOwner.status, 404);
  assert.equal((await crossOwner.json()).error.code, 'NOT_FOUND');
  let staffPolicyCalls = 0;
  const scopedApp = createPatientApp({
    connection,
    verifyBearerToken: async () => ({ sub: 'staff-user', actorType: 'STAFF', capabilities: ['RECEPTION'] }),
    authorizeScopedRead: async ({ authContext, patientId: requestedId }) => {
      staffPolicyCalls += 1;
      return authContext.actorType === 'STAFF' && requestedId === patientA;
    },
  });
  const scopedBase = await listen(scopedApp, t);
  const scopedRead = await fetch(scopedBase + '/api/v1/patients/' + patientA, { headers: { authorization: 'Bearer staff' } });
  assert.equal(scopedRead.status, 200);
  assert.equal((await scopedRead.json()).data.patient.id, patientA);
  assert.equal(staffPolicyCalls, 1);
  assert.equal((await fetch(base + '/api/v1/patients')).status, 401);
  assert.equal((await fetch(base + '/api/v1/patients?limit=101', { headers: { authorization: 'Bearer ownerA' } })).status, 400);
});
test('AP-004 returns only open available slots in the Vietnam business day', async (t) => {
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '8.0.16' } });
  const connection = await mongoose.createConnection(mongod.getUri(), { dbName: 'appointment_db', autoCreate: false, autoIndex: false }).asPromise();
  t.after(async () => { await connection.close(); await mongod.stop(); });
  await ensureAppointmentStorage(connection);
  const Schedule = getScheduleModel(connection);
  const Slot = getSlotModel(connection);
  await Schedule.create([
    { id: 'sched-day-start', doctorId: doctor, serviceId: service, startAt: new Date('2026-10-24T17:00:00.000Z'), endAt: new Date('2026-10-25T09:00:00.000Z'), status: 'OPEN' },
    { id: 'sched-other-doctor', doctorId: ownerB, serviceId: service, startAt: new Date('2026-10-24T17:00:00.000Z'), endAt: new Date('2026-10-25T09:00:00.000Z'), status: 'OPEN' },
  ]);
  await Slot.create([
    { id: 'slot-at-vn-midnight', scheduleId: 'sched-day-start', startAt: new Date('2026-10-24T17:00:00.000Z'), endAt: new Date('2026-10-24T17:30:00.000Z'), capacity: 2, heldCount: 0, confirmedCount: 0 },
    { id: 'slot-full', scheduleId: 'sched-day-start', startAt: new Date('2026-10-24T17:30:00.000Z'), endAt: new Date('2026-10-24T18:00:00.000Z'), capacity: 1, heldCount: 1, confirmedCount: 0 },
    { id: 'slot-before-day', scheduleId: 'sched-day-start', startAt: new Date('2026-10-24T16:59:00.000Z'), endAt: new Date('2026-10-24T17:00:00.000Z'), capacity: 1, heldCount: 0, confirmedCount: 0 },
    { id: 'slot-wrong-doctor', scheduleId: 'sched-other-doctor', startAt: new Date('2026-10-24T18:00:00.000Z'), endAt: new Date('2026-10-24T18:30:00.000Z'), capacity: 1, heldCount: 0, confirmedCount: 0 },
  ]);
  const base = await listen(createAppointmentApp({ connection }), t);
  const response = await fetch(base + '/api/v1/slots/available?doctorId=' + doctor + '&serviceId=' + service + '&date=2026-10-25');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.data.items.map((item) => item.slotId), ['slot-at-vn-midnight']);
  assert.equal(payload.data.items[0].remainingCapacity, 2);
  assert.equal(payload.meta.correlationId, response.headers.get('x-correlation-id'));
  const badDate = await fetch(base + '/api/v1/slots/available?doctorId=' + doctor + '&serviceId=' + service + '&date=2026-02-30');
  assert.equal(badDate.status, 400);
  const outOfRangeDate = await fetch(base + '/api/v1/slots/available?doctorId=' + doctor + '&serviceId=' + service + '&date=2026-13-30');
  assert.equal(outOfRangeDate.status, 400);
});