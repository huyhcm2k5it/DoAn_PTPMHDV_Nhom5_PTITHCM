const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mongoHarness } = require('./test-harness');
const { ensurePatientStorage } = require('../../services/patient/src/dbs/indexes');
const { ensureAppointmentStorage } = require('../../services/appointment/src/dbs/indexes');
const { createApp: patientApp } = require('../../services/patient/src/app');
const { createApp: appointmentApp } = require('../../services/appointment/src/app');
const { parseSchedule } = require('../../services/appointment/src/services/schedules.service');
const h = mongoHarness(ensurePatientStorage, 'patient_regression');
const a = mongoHarness(ensureAppointmentStorage, 'appointment_regression');
const owner = randomUUID(),
  staff = randomUUID(),
  doctor = randomUUID();
const now = new Date('2026-12-01T01:00:00Z');
const claims = {
  owner: { sub: owner, actorType: 'PATIENT', tokenVersion: 1, capabilities: [] },
  staff: { sub: staff, actorType: 'STAFF', tokenVersion: 1, capabilities: ['ADMIN', 'RECEPTION'] },
  doctor: { sub: doctor, actorType: 'DOCTOR', tokenVersion: 1, capabilities: [] },
};
async function serve(t, factory, overrides = {}) {
  const connection = factory === appointmentApp ? a.connection : h.connection;
  for (const c of Object.values(claims))
    await connection.collection('user_access_projection').updateOne(
      { userId: c.sub },
      {
        $setOnInsert: {
          userId: c.sub,
          status: 'ACTIVE',
          actorType: c.actorType,
          tokenVersion: c.tokenVersion,
          capabilities: c.capabilities,
        },
      },
      { upsert: true },
    );
  const app = factory({
    connection,
    now: () => now,
    verifyBearerToken: async (token) => claims[token],
    verifyAuthorizationLease: async (token, opts) => ({
      sub: opts.subject,
      tokenVersion: opts.tokenVersion,
      action: opts.action,
      tokenType: 'LEASE',
      iat: Math.floor(+now / 1000),
      exp: Math.floor(+now / 1000) + 30,
    }),
    ...overrides,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  return async (
    path,
    { method = 'GET', body, actor = 'owner', key = randomUUID(), headers = {} } = {},
  ) => {
    const r = await fetch('http://127.0.0.1:' + server.address().port + path, {
      method,
      headers: {
        authorization: 'Bearer ' + actor,
        'content-type': 'application/json',
        'idempotency-key': key,
        'x-authorization-lease': 'test',
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
}
const profile = (fields = {}) => ({
  fullName: 'Regression Person',
  birthDate: '1990-01-01',
  relation: 'OTHER',
  ...fields,
});
test('F01: distinct idempotency keys cannot create duplicate active identities concurrently', async (t) => {
  const req = await serve(t, patientApp);
  const results = await Promise.all(
    Array.from({ length: 6 }, () => req('/api/v1/patients', { method: 'POST', body: profile() })),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409, 409, 409]);
  assert.equal(await h.connection.collection('patients').countDocuments({ ownerUserId: owner }), 1);
  assert.equal(
    await h.connection
      .collection('outbox')
      .countDocuments({ message_type: 'PatientAccessChanged' }),
    1,
  );
  for (const r of results.filter((x) => x.status === 409))
    assert.equal(r.body.error.code, 'DUPLICATE_PATIENT_PROFILE');
});
test('F01: concurrent SELF profiles with different names still have one winner', async (t) => {
  const req = await serve(t, patientApp);
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      req('/api/v1/patients', {
        method: 'POST',
        body: profile({ fullName: 'Self ' + i, relation: 'SELF' }),
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409]);
});
test('F02/F06: PATCH rejects relation, forged properties, optional object and stale version', async (t) => {
  const req = await serve(t, patientApp);
  const created = await req('/api/v1/patients', {
    method: 'POST',
    body: profile({ contactPhone: '0900000000', address: 'Test address' }),
  });
  assert.equal(created.status, 201);
  const path = '/api/v1/patients/' + created.body.data.patient.id;
  for (const body of [
    { relation: 'SELF', expectedVersion: 1 },
    { ownerUserId: staff, expectedVersion: 1 },
    { address: { value: 'invalid' }, expectedVersion: 1 },
    { expectedVersion: '1', fullName: 'Invalid version' },
  ])
    assert.equal((await req(path, { method: 'PATCH', body })).status, 400);
  const updated = await req(path, {
    method: 'PATCH',
    body: { fullName: 'Updated Regression', expectedVersion: 1 },
  });
  assert.equal(updated.status, 200);
  const stale = await req(path, {
    method: 'PATCH',
    body: { fullName: 'Stale Regression', expectedVersion: 1 },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STATE_CONFLICT');
  const cleared = await req(path, { method: 'PATCH', body: { address: null, expectedVersion: 2 } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.data.patient.address, undefined);
});
test('F03: default reception policy uses current capability, doctor requires exact trusted scope', async (t) => {
  const req = await serve(t, patientApp);
  const created = await req('/api/v1/patients', { method: 'POST', body: profile() });
  const path = '/api/v1/patients/' + created.body.data.patient.id;
  assert.equal((await req(path, { actor: 'staff' })).status, 200);
  assert.equal(
    (
      await req(path, {
        actor: 'doctor',
        headers: { 'x-patient-scope': created.body.data.patient.id },
      })
    ).status,
    403,
  );
  const scoped = await serve(t, patientApp, {
    verifyBearerToken: async () => ({
      ...claims.doctor,
      scopes: ['patient:' + created.body.data.patient.id],
    }),
  });
  assert.equal((await scoped(path)).status, 200);
  assert.equal((await scoped('/api/v1/patients/' + randomUUID())).status, 403);
  await h.connection
    .collection('user_access_projection')
    .updateOne({ userId: staff }, { $set: { capabilities: ['CASHIER'] } });
  assert.equal((await req(path, { actor: 'staff' })).status, 403);
});
test('F04: protected appointment reads fail closed on blocked, stale, revoked and missing identity', async (t) => {
  const req = await serve(t, appointmentApp);
  const paths = [
    '/api/v1/admin/appointments/summary?from=2026-12-01&to=2026-12-02',
    '/api/v1/schedules',
    '/api/v1/queues/today',
  ];
  for (const patch of [
    { status: 'BLOCKED' },
    { status: 'ACTIVE', tokenVersion: 2 },
    { tokenVersion: 1, capabilities: [] },
  ]) {
    await a.connection
      .collection('user_access_projection')
      .updateOne({ userId: staff }, { $set: patch });
    for (const path of paths) assert.equal((await req(path, { actor: 'staff' })).status, 403, path);
  }
  await a.connection.collection('user_access_projection').deleteOne({ userId: staff });
  for (const path of paths) assert.equal((await req(path, { actor: 'staff' })).status, 503, path);
});
test('F05/F07: canonical range works and malformed, empty, impossible, reversed ranges return 400', async (t) => {
  const req = await serve(t, appointmentApp);
  await a.connection.collection('appointments').insertMany(
    [
      '2026-11-30T16:59:59Z',
      '2026-11-30T17:00:00Z',
      '2026-12-02T16:59:59Z',
      '2026-12-02T17:00:00Z',
    ].map((startAt) => ({
      id: randomUUID(),
      holdId: randomUUID(),
      state: 'CONFIRMED',
      startAt: new Date(startAt),
    })),
  );
  const prefix = '/api/v1/admin/appointments/summary';
  const good = await req(prefix + '?from=2026-12-01&to=2026-12-03', { actor: 'staff' });
  assert.equal(good.status, 200);
  assert.equal(good.body.data.booked, 2);
  assert.deepEqual(Object.keys(good.body.data).sort(), [
    'asOf',
    'booked',
    'cancelled',
    'checkedIn',
    'completed',
    'syncStatus',
  ]);
  for (const q of [
    'date=2026-12-01',
    'from=bad&to=2026-12-03',
    'from=2026-02-30&to=2026-03-02',
    'from=2026-12-03&to=2026-12-01',
    'from=2026-12-01&to=2026-12-01',
    'from=&to=2026-12-03',
    'from=2026-12-01&from=2026-12-02&to=2026-12-03',
  ])
    assert.equal((await req(prefix + '?' + q, { actor: 'staff' })).status, 400, q);
  const patientId = randomUUID();
  await a.connection
    .collection('patient_access_projection')
    .insertOne({ patientId, ownerUserId: owner, active: true, policyVersion: 1 });
  for (const q of ['from=not-a-date', 'from=2026-02-30', 'from=2026-12-03&to=2026-12-01']) {
    assert.equal(
      (await req('/api/v1/patients/' + patientId + '/appointments?' + q)).status,
      400,
      q,
    );
    assert.equal((await req('/api/v1/schedules?' + q, { actor: 'staff' })).status, 400, q);
  }
});
test('D02: schedule PATCH permits slotMinutes but rejects doctor/service/status and null', () => {
  assert.deepEqual(parseSchedule({ slotMinutes: 15, expectedVersion: 1 }, { partial: true }), {
    slotMinutes: 15,
  });
  for (const body of [
    { doctorId: randomUUID() },
    { serviceId: randomUUID() },
    { status: 'CLOSED' },
    { slotMinutes: null },
    { slotMinutes: '15' },
    { capacityPerSlot: '2' },
    { startAt: 123 },
  ])
    assert.throws(() => parseSchedule({ ...body, expectedVersion: 1 }, { partial: true }), {
      code: 'VALIDATION_ERROR',
    });
});

test('AP-019 syncStatus reflects real local retry/outbox/quarantine and never fabricates SYNCED', async (t) => {
  const req = await serve(t, appointmentApp);
  const path = '/api/v1/admin/appointments/summary?from=2026-12-01&to=2026-12-02';
  const status = async (expected) => {
    const result = await req(path, { actor: 'staff' });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.syncStatus, expected);
    assert.equal(result.body.data.asOf, now.toISOString());
    assert.equal(result.body.data.booked, 0);
  };
  await status('UNKNOWN');
  await a.connection
    .collection('retry_jobs')
    .insertOne({ id: randomUUID(), consumerName: 'other', state: 'PENDING' });
  await a.connection
    .collection('dead_letters')
    .insertOne({ id: randomUUID(), consumerName: 'appointment', state: 'RESOLVED' });
  await status('UNKNOWN');
  const message = randomUUID();
  await a.connection.collection('outbox').insertOne({ message_id: message, published_at: null });
  await status('PENDING');
  await a.connection
    .collection('outbox')
    .updateOne({ message_id: message }, { $set: { published_at: now } });
  await status('UNKNOWN');
  const retry = randomUUID();
  await a.connection
    .collection('retry_jobs')
    .insertOne({ id: retry, consumerName: 'appointment', state: 'PENDING' });
  await status('PENDING');
  await a.connection
    .collection('dead_letters')
    .insertOne({ id: randomUUID(), consumerName: 'appointment', state: 'QUARANTINED' });
  await status('DEGRADED');
  await a.connection
    .collection('dead_letters')
    .updateMany({ state: 'QUARANTINED' }, { $set: { state: 'RESOLVED' } });
  await status('PENDING');
  await a.connection.collection('retry_jobs').updateOne({ id: retry }, { $set: { state: 'DONE' } });
  await status('UNKNOWN');
});
test('AP-019 fails with 503 when synchronization evidence cannot be read', async () => {
  const {
    getReportSyncStatus,
  } = require('../../services/appointment/src/services/report-sync.service');
  await assert.rejects(
    getReportSyncStatus({
      collection: () => ({
        findOne: async () => {
          throw new Error('DB unavailable');
        },
      }),
    }),
    { status: 503, code: 'SERVICE_UNAVAILABLE' },
  );
});
