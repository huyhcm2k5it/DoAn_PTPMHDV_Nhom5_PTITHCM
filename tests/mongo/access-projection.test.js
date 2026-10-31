const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { ensureAppointmentStorage } = require('../../services/appointment/src/dbs/indexes.js');
const {
  applyAccessProjection,
  authorizePatientAccess,
} = require('../../services/appointment/src/services/access-projection.service.js');

const userId = '00000000-0000-4000-8000-000000000911';
const patientId = '00000000-0000-4000-8000-000000000701';

test('access projection is idempotent, monotonic and fail-closed', async (t) => {
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
  const base = {
    messageType: 'IdentityAccessChanged',
    payload: {
      userId,
      actorType: 'PATIENT',
      capabilities: [],
      status: 'ACTIVE',
      tokenVersion: 1,
      policyVersion: 2,
    },
  };
  assert.deepEqual(
    await applyAccessProjection({ connection, message: { ...base, messageId: 'identity-2' } }),
    { duplicate: false },
  );
  assert.deepEqual(
    await applyAccessProjection({ connection, message: { ...base, messageId: 'identity-2' } }),
    { duplicate: true },
  );
  await assert.rejects(
    applyAccessProjection({
      connection,
      message: { ...base, messageId: 'identity-2', payload: { ...base.payload, policyVersion: 3 } },
    }),
    (error) => error.code === 'MESSAGE_CONFLICT',
  );
  assert.deepEqual(
    await applyAccessProjection({
      connection,
      message: {
        ...base,
        messageId: 'identity-1',
        payload: { ...base.payload, policyVersion: 1, status: 'REVOKED' },
      },
    }),
    { duplicate: false },
  );
  assert.equal(
    (await connection.collection('user_access_projection').findOne({ userId })).policyVersion,
    2,
  );
  assert.deepEqual(
    await applyAccessProjection({
      connection,
      message: {
        messageId: 'patient-1',
        messageType: 'PatientAccessChanged',
        payload: { patientId, ownerUserId: userId, active: true, policyVersion: 3 },
      },
    }),
    { duplicate: false },
  );
  assert.equal(
    await authorizePatientAccess({
      connection,
      authContext: { userId, actorType: 'PATIENT', capabilities: [] },
      patientId,
    }),
    true,
  );
  assert.equal(
    await authorizePatientAccess({
      connection,
      authContext: {
        userId: '00000000-0000-4000-8000-000000000912',
        actorType: 'PATIENT',
        capabilities: [],
      },
      patientId,
    }),
    false,
  );
});
