const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { mongoHarness } = require('./test-harness');
const appointmentOpenApi = require('../../contracts/http/appointment.openapi.json');
const { handleBillingMessage } = require('../../services/appointment/src/workers/billing-events.worker');
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
  const connection = await mongoose.createConnection(mongod.getUri(), {
    dbName: 'patient_db',
    autoCreate: false,
    autoIndex: false,
    runtimeAdapters: { os: require('node:os') },
  }).asPromise();
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
  const connection = await mongoose.createConnection(mongod.getUri(), {
    dbName: 'appointment_db',
    autoCreate: false,
    autoIndex: false,
    runtimeAdapters: { os: require('node:os') },
  }).asPromise();
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

test.describe('Appointment OpenAPI read responses', () => {
  const h = mongoHarness(ensureAppointmentStorage, 'appointment_db');
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const contract = 'urn:umc-care:appointment-http';
  ajv.addSchema(appointmentOpenApi, contract);

  test('AP-011 and AP-012 validate and expose the latest refund status', async (t) => {
    const id = randomUUID();
    const chargeId = randomUUID();
    const rows = h.connection.collection('appointments');
    await rows.insertOne({
      id,
      holdId: randomUUID(),
      chargeId,
      patientId: patientA,
      recipientUserId: ownerA,
      slotId: randomUUID(),
      doctorId: doctor,
      serviceId: service,
      state: 'CANCELLED',
      chargeSync: 'CREATED',
      chargeStatus: 'PAID',
      version: 1,
      createdAt: new Date('2026-11-24T00:00:00Z'),
    });
    const base = await listen(createAppointmentApp({
      connection: h.connection,
      verifyBearerToken: async (token) => tokenClaims[token],
      authorizePatientAccess: async ({ authContext, patientId }) =>
        patientId === patientA && authContext.userId === ownerA,
    }), t);
    async function get(path, contractPath) {
      const res = await fetch(base + path, { headers: { authorization: 'Bearer ownerA' } });
      assert.equal(res.status, 200);
      const body = await res.json();
      const schema = appointmentOpenApi.paths[contractPath].get.responses['200']
        .content['application/json'].schema;
      const validate = ajv.compile({ $ref: contract + schema.$ref });
      assert.ok(validate(body), JSON.stringify(validate.errors));
      return body.data;
    }
    const detailPath = '/api/v1/appointments/' + id;
    const detailContract = '/api/v1/appointments/{appointmentId}';
    assert.equal((await get(detailPath, detailContract)).refundStatus, 'NONE');
    for (const [version, refundStatus] of [[3, 'SUCCEEDED'], [2, 'REQUESTED']]) {
      await handleBillingMessage({
        connection: h.connection,
        message: {
          messageId: randomUUID(),
          messageKind: 'EVENT',
          messageType: 'BillingStatusChanged',
          producer: 'billing',
          payload: { chargeId, sourceId: id, version, refundStatus },
        },
      });
    }
    const detail = await get(detailPath, detailContract);
    assert.equal(detail.refundStatus, 'SUCCEEDED');
    assert.deepEqual(detail.chargeSync, { state: 'CREATED', chargeId });
    assert.equal(detail.appointment._id, undefined);
    assert.equal((await rows.findOne({ id })).billingStatusVersion, undefined);
    const list = await get(
      '/api/v1/patients/' + patientA + '/appointments?page=1&limit=20',
      '/api/v1/patients/{patientId}/appointments',
    );
    assert.equal(list.items[0].id, id);
    assert.equal(list.total, 1);
  });

  test('AP-019 returns only the summary fields declared in OpenAPI', async (t) => {
    const now = new Date('2026-11-24T01:00:00Z');
    await h.connection.collection('appointments').insertOne({
      id: randomUUID(), holdId: randomUUID(), patientId: patientA,
      slotId: randomUUID(), doctorId: doctor, serviceId: service,
      state: 'COMPLETED', version: 1, startAt: now,
      stateHistory: ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED']
        .map((state) => ({ state, at: now })),
    });
    const base = await listen(createAppointmentApp({
      connection: h.connection,
      verifyBearerToken: async () => ({
        sub: ownerA, actorType: 'STAFF', capabilities: ['ADMIN'],
      }),
    }), t);
    const response = await fetch(base + '/api/v1/admin/appointments/summary?date=2026-11-24',
      { headers: { authorization: 'Bearer staff' } });
    assert.equal(response.status, 200);
    const body = await response.json();
    const schema = appointmentOpenApi.paths['/api/v1/admin/appointments/summary']
      .get.responses['200'].content['application/json'].schema;
    const validate = ajv.compile({ $ref: contract + schema.$ref });
    assert.ok(validate(body), JSON.stringify(validate.errors));
    assert.deepEqual({ ...body.data, asOf: undefined },
      { booked: 1, cancelled: 0, checkedIn: 1, completed: 1, asOf: undefined });
    const invalid = await fetch(base + '/api/v1/admin/appointments/summary?date=2026-02-30',
      { headers: { authorization: 'Bearer staff' } });
    assert.equal(invalid.status, 400);
  });

  test('AP-013 through AP-018 mutation responses match OpenAPI', async (t) => {
    const now = new Date('2026-11-24T00:00:00Z');
    const holdId = randomUUID(), scheduleId = randomUUID();
    const slotId = randomUUID(), newSlotId = randomUUID(), id = randomUUID();
    const quote = { amountVnd: 100000, priceVersionId: randomUUID(), snapshotHash: 'test-quote' };
    await h.connection.collection('patient_access_projection').insertOne({
      patientId: patientA, ownerUserId: ownerA, active: true,
    });
    await h.connection.collection('schedules').insertOne({
      id: scheduleId, doctorId: doctor, doctorUserId: doctor, departmentId: service,
      serviceId: service, status: 'OPEN',
    });
    for (const [key, hour, confirmedCount] of [[slotId, 4, 1], [newSlotId, 5, 0]]) {
      await h.connection.collection('slots').insertOne({
        id: key, scheduleId, capacity: 2, heldCount: 0, confirmedCount, version: 1,
        startAt: new Date(+now + hour * 3600000), endAt: new Date(+now + hour * 3600000 + 1800000),
      });
    }
    await h.connection.collection('holds').insertOne({
      id: holdId, priceSnapshot: quote, principalId: ownerA, idempotencyKey: randomUUID(),
      patientId: patientA, slotId, expiresAt: new Date(+now + 600000),
    });
    const original = {
      id, holdId, patientId: patientA, principalId: ownerA, recipientUserId: ownerA,
      slotId, scheduleId, doctorId: doctor, doctorUserId: doctor, departmentId: service,
      serviceId: service, state: 'CONFIRMED', chargeStatus: 'PAID', chargeSync: 'CREATED',
      sourceRevision: 1, version: 1, createdAt: now, updatedAt: now,
      startAt: new Date(+now + 4 * 3600000), endAt: new Date(+now + 4.5 * 3600000),
    };
    await h.connection.collection('appointments').insertOne(original);
    const base = await listen(createAppointmentApp({
      connection: h.connection,
      now: () => now,
      resolvePriceSnapshot: async () => quote,
      verifyBearerToken: async () => ({ sub: ownerA, actorType: 'STAFF', capabilities: ['RECEPTION'] }),
      verifyAuthorizationLease: async (_token, options) => ({
        tokenType: 'LEASE', action: options.action, sub: options.subject,
        tokenVersion: options.tokenVersion, iat: +now / 1000, exp: +now / 1000 + 30,
      }),
      authorizePatientAccess: async () => true,
    }), t);
    async function request(method, path, input) {
      const response = await fetch(base + path, {
        method,
        headers: {
          authorization: 'Bearer staff', 'x-authorization-lease': 'test',
          'content-type': 'application/json', 'idempotency-key': randomUUID(),
        },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      const template = Object.keys(appointmentOpenApi.paths).find((route) =>
        new RegExp('^' + route.replace(/\{[^}]+\}/g, '[^/]+') + '$').test(path.split('?')[0]));
      const schema = appointmentOpenApi.paths[template][method.toLowerCase()]
        .responses['200'].content['application/json'].schema;
      const validate = ajv.compile({ $ref: contract + schema.$ref });
      assert.ok(validate(body), JSON.stringify(validate.errors));
      return body.data;
    }
    const moved = await request('POST', '/api/v1/appointments/' + id + '/reschedule',
      { newSlotId, expectedVersion: 1 });
    assert.equal(moved.appointment.slotId, newSlotId);
    const cancelled = await request('POST', '/api/v1/appointments/' + id + '/cancel',
      { reasonCode: 'PATIENT_REQUEST', expectedVersion: moved.appointment.version });
    assert.equal(cancelled.state, 'CANCELLED');
    const checkId = randomUUID();
    await h.connection.collection('appointments').insertOne({
      ...original, _id: new mongoose.Types.ObjectId(), id: checkId, holdId: randomUUID(),
    });
    const checked = await request('POST', '/api/v1/appointments/' + checkId + '/check-in',
      { expectedVersion: 1 });
    const queue = await request('GET', '/api/v1/queues/today?ticketType=FIRST');
    assert.equal(queue.items[0].ticketId, checked.ticket.ticketId);
    const called = await request('POST', '/api/v1/queues/call-next', { ticketType: 'FIRST' });
    assert.equal(called.ticket.ticketId, checked.ticket.ticketId);
    await request('POST', '/api/v1/queues/' + called.ticket.ticketId + '/no-show',
      { expectedVersion: called.ticket.version, reasonCode: 'PATIENT_ABSENT' });
  });

});
