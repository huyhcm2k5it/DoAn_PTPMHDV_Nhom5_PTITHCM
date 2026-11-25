const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mongoHarness } = require('./test-harness');
const { ensurePatientStorage } = require('../../services/patient/src/dbs/indexes');
const { getPatientModel } = require('../../services/patient/src/models/patient.model');
const {
  createPatient,
  updatePatient,
} = require('../../services/patient/src/services/manage-patient.service');
const h = mongoHarness(ensurePatientStorage, 'patient_db');
async function input(actorType = 'PATIENT') {
  const userId = randomUUID();
  await h.connection.collection('user_access_projection').insertOne({
    userId,
    status: 'ACTIVE',
    actorType,
    capabilities: ['RECEPTION'],
    tokenVersion: 1,
  });
  return {
    connection: h.connection,
    Patient: getPatientModel(h.connection),
    authContext: { userId, actorType, tokenVersion: 1 },
    body: { fullName: 'A Patient', birthDate: '1990-01-01', relation: 'SELF' },
    idempotencyKey: randomUUID(),
  };
}
test('same intent creates one profile audit and outbox', async () => {
  const args = await input();
  const first = await createPatient(args);
  const second = await createPatient(args);
  assert.equal(first.id, second.id);
  assert.equal(await h.connection.collection('patients').countDocuments({}), 1);
  assert.equal(await h.connection.collection('profile_audit').countDocuments({}), 1);
  assert.equal(await h.connection.collection('outbox').countDocuments({}), 1);
});
test('changed body same key returns 409', async () => {
  const args = await input();
  await createPatient(args);
  await assert.rejects(
    createPatient({ ...args, body: { ...args.body, fullName: 'Changed' } }),
    (e) => e.status === 409 || e.statusCode === 409,
  );
});
test('reception cannot assign unverified account', async () => {
  const args = await input('STAFF');
  const ownerUserId = randomUUID();
  await h.connection.collection('user_access_projection').insertOne({
    userId: ownerUserId,
    actorType: 'PATIENT',
    status: 'ACTIVE',
    phoneVerified: false,
    phone: '0901234567',
  });
  await assert.rejects(
    createPatient({ ...args, body: { ...args.body, ownerPhone: '0901234567' } }),
    (e) => e.status === 403 || e.statusCode === 403,
  );
});
test('patient cannot forge another owner', async () => {
  const args = await input();
  await assert.rejects(
    createPatient({ ...args, body: { ...args.body, ownerUserId: randomUUID() } }),
    (e) => e.status === 403 || e.statusCode === 403,
  );
});

test('audit records only actual profile field changes and no-op replay stays quiet', async () => {
  const args = await input();
  const created = await createPatient({
    ...args,
    body: { ...args.body, birthDate: '2000-02-29', sex: 'FEMALE' },
  });
  const audit = h.connection.collection('profile_audit');
  const auditFields = ['action', 'actorUserId', 'at', 'changedFields', 'id', 'patientId'];
  const initial = await audit.findOne({ action: 'CREATED' });
  const storedFields = (record) =>
    Object.keys(record)
      .filter((key) => key !== '_id')
      .sort();
  assert.deepEqual(storedFields(initial), auditFields);
  assert.ok(initial.changedFields.includes('birthDate'));
  assert.ok(initial.changedFields.includes('sex'));
  assert.ok(!initial.changedFields.includes('2000-02-29'));
  const update = {
    ...args,
    patientId: created.id,
    expectedVersion: created.version,
    body: { fullName: '  A Patient  ', sex: null, address: 'New address' },
    idempotencyKey: randomUUID(),
  };
  const changed = await updatePatient(update);
  assert.equal(changed.sex, undefined);
  assert.deepEqual(await updatePatient(update), changed);
  const updatedAudit = await audit.findOne({ action: 'UPDATED' });
  assert.deepEqual(storedFields(updatedAudit), auditFields);
  assert.deepEqual(updatedAudit.changedFields, ['sex', 'address']);

  const noOp = await updatePatient({
    ...update,
    expectedVersion: changed.version,
    body: { fullName: '  A Patient ' },
    idempotencyKey: randomUUID(),
  });
  assert.equal(noOp.version, changed.version);
  assert.equal(await audit.countDocuments(), 2);
  assert.equal(await h.connection.collection('outbox').countDocuments(), 2);
});

test('patient rejects impossible dates and undeclared sex values', async () => {
  const args = await input();
  for (const patch of [{ birthDate: '2026-02-31' }, { sex: 'UNRECOGNIZED' }])
    await assert.rejects(createPatient({ ...args, body: { ...args.body, ...patch } }), {
      code: 'VALIDATION_ERROR',
    });
  assert.equal(await h.connection.collection('patients').countDocuments(), 0);
});

test('patient rejects duplicate profile with 409 DUPLICATE_PATIENT_PROFILE', async () => {
  const args = await input();
  await createPatient(args);
  // Same owner, new idempotency key, same fullName and birthDate
  await assert.rejects(
    createPatient({
      ...args,
      idempotencyKey: randomUUID(),
      body: { ...args.body, relation: 'OTHER' },
    }),
    (e) => (e.status === 409 || e.statusCode === 409) && e.code === 'DUPLICATE_PATIENT_PROFILE',
  );
  // Same owner, new idempotency key, second SELF profile
  await assert.rejects(
    createPatient({
      ...args,
      idempotencyKey: randomUUID(),
      body: { fullName: 'Different Name', birthDate: '1995-05-05', relation: 'SELF' },
    }),
    (e) => (e.status === 409 || e.statusCode === 409) && e.code === 'DUPLICATE_PATIENT_PROFILE',
  );
});
