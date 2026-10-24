const mongoose = require('mongoose');
const assert = require('node:assert/strict');
const { after, before, beforeEach, test } = require('node:test');
const { randomBytes } = require('node:crypto');
const { MongoServerError } = mongoose.mongo;
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { ensurePatientStorage } = require('../../services/patient/src/dbs/indexes.js');
const { ensureAppointmentStorage } = require('../../services/appointment/src/dbs/indexes.js');
const { ensurePharmacyStorage } = require('../../services/pharmacy/src/dbs/indexes.js');
const { withMongoTransaction } = require('../../mongo/transaction.js');
const { ownerDatabases, provisionOwnerUser } = require('../../mongo/service-users.js');

let server;
let connection;
let patientConnection, appointmentConnection, pharmacyConnection;
let patient, appointment, pharmacy;
const password = randomBytes(24).toString('hex');
const mongoVersion = '8.0.16';
const isDuplicate = (e) => e instanceof MongoServerError && e.code === 11000;
const isInvalid = (e) => e instanceof MongoServerError && e.code === 121;

before(async () => {
  server = await MongoMemoryReplSet.create({
    binary: { version: mongoVersion },
    replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1', auth: {
      enable: true, customRootName: 'umc-test-root', customRootPwd: password,
      keyfileContent: randomBytes(96).toString('base64'),
    } },
  });
  connection = await mongoose.createConnection(server.getUri(), {
    dbName: 'admin', autoCreate: false, autoIndex: false,
    auth: { username: 'umc-test-root', password }, authSource: 'admin',
    serverSelectionTimeoutMS: 10000,
  }).asPromise();
  patientConnection = connection.useDb('patient_db', { useCache: true });
  patient = patientConnection.db;
  appointmentConnection = connection.useDb('appointment_db', { useCache: true });
  appointment = appointmentConnection.db;
  pharmacyConnection = connection.useDb('pharmacy_db', { useCache: true });
  pharmacy = pharmacyConnection.db;
  await ensurePatientStorage(patientConnection);
  await ensureAppointmentStorage(appointmentConnection);
  await ensurePharmacyStorage(pharmacyConnection);
}, { timeout: 240000 });

beforeEach(async () => {
  for (const db of [patient, appointment, pharmacy]) {
    if (!db) continue;
    for (const c of await db.listCollections({}, { nameOnly: true }).toArray()) {
      await db.collection(c.name).deleteMany({});
    }
  }
});

after(async () => { await connection?.close(); await server?.stop(); });

test('Patient rejects a repeated opaque patient id but allows several profiles for one owner', async () => {
  await patient.collection('patients').insertMany([
    { id: 'p1', ownerUserId: 'u1' }, { id: 'p2', ownerUserId: 'u1' },
  ]);
  await assert.rejects(patient.collection('patients').insertOne({ id: 'p1', ownerUserId: 'u2' }), isDuplicate);
  assert.equal(await patient.collection('patients').countDocuments({ ownerUserId: 'u1' }), 2);
});

test('Patient rejects a profile without an owner', async () => {
  await assert.rejects(patient.collection('patients').insertOne({ id: 'orphan' }), isInvalid);
});

test('Appointment rejects duplicate schedule/startAt slots', async () => {
  const doc = { scheduleId: 's1', startAt: new Date('2026-10-25T01:00:00Z'), capacity: 1, heldCount: 0, confirmedCount: 0 };
  await appointment.collection('slots').insertOne({ ...doc, id: 'sl1' });
  await assert.rejects(appointment.collection('slots').insertOne({ ...doc, id: 'sl2' }), isDuplicate);
});

test('Appointment rejects capacity overflow and negative held counts', async () => {
  const doc = { id: 'sl1', scheduleId: 's1', startAt: new Date(), capacity: 1, heldCount: 0, confirmedCount: 0 };
  await assert.rejects(appointment.collection('slots').insertOne({ ...doc, heldCount: 1, confirmedCount: 1 }), isInvalid);
  await assert.rejects(appointment.collection('slots').insertOne({ ...doc, heldCount: -1 }), isInvalid);
});

test('Appointment deduplicates hold keys within a principal, not across principals', async () => {
  const doc = { slotId: 'sl1', patientId: 'p1', expiresAt: new Date(), idempotencyKey: 'k1' };
  await appointment.collection('holds').insertOne({ ...doc, id: 'h1', principalId: 'u1' });
  await appointment.collection('holds').insertOne({ ...doc, id: 'h2', principalId: 'u2' });
  await assert.rejects(appointment.collection('holds').insertOne({ ...doc, id: 'h3', principalId: 'u1' }), isDuplicate);
});

test('Appointment rejects a hold missing the principal needed by its dedupe key', async () => {
  await assert.rejects(appointment.collection('holds').insertOne({ id: 'h1', slotId: 'sl1', patientId: 'p1', expiresAt: new Date(), idempotencyKey: 'k1' }), isInvalid);
});

test('Appointment rejects null or empty principals rather than reserving a shared null dedupe key', async () => {
  for (const principalId of [null, '']) {
    await assert.rejects(appointment.collection('holds').insertOne({ id: 'h1', slotId: 'sl1', patientId: 'p1', expiresAt: new Date(), principalId, idempotencyKey: 'k1' }), isInvalid);
  }
});

test('Appointment consumes a hold into at most one appointment', async () => {
  await appointment.collection('appointments').insertOne({ id: 'a1', holdId: 'h1' });
  await assert.rejects(appointment.collection('appointments').insertOne({ id: 'a2', holdId: 'h1' }), isDuplicate);
});

test('Appointment keeps FIRST and RETURN tickets distinct, deduplicating each round', async () => {
  await appointment.collection('queue_tickets').insertMany([
    { id: 'q1', appointmentId: 'a1', ticketType: 'FIRST', returnRound: 0 },
    { id: 'q2', appointmentId: 'a1', ticketType: 'RETURN', returnRound: 1 },
  ]);
  await assert.rejects(appointment.collection('queue_tickets').insertOne({ id: 'q3', appointmentId: 'a1', ticketType: 'RETURN', returnRound: 1 }), isDuplicate);
});

test('Appointment allows unclaimed/null tickets but rejects duplicate non-null claim ids', async () => {
  const c = appointment.collection('queue_tickets');
  await c.insertMany([
    { id: 'q1', appointmentId: 'a1', ticketType: 'FIRST', returnRound: 0 },
    { id: 'q2', appointmentId: 'a2', ticketType: 'FIRST', returnRound: 0, claimId: null },
    { id: 'q3', appointmentId: 'a3', ticketType: 'FIRST', returnRound: 0, claimId: null },
    { id: 'q4', appointmentId: 'a4', ticketType: 'FIRST', returnRound: 0, claimId: 'cl1' },
  ]);
  await assert.rejects(c.insertOne({ id: 'q5', appointmentId: 'a5', ticketType: 'FIRST', returnRound: 0, claimId: 'cl1' }), isDuplicate);
});

test('Appointment has only one time-lock document per patient', async () => {
  await appointment.collection('patient_time_locks').insertOne({ patientId: 'p1', intervals: [], version: 1 });
  await assert.rejects(appointment.collection('patient_time_locks').insertOne({ patientId: 'p1', intervals: [], version: 1 }), isDuplicate);
});

test('Pharmacy rejects duplicate inventory medicine ids', async () => {
  await pharmacy.collection('inventory').insertOne({ id: 'i1', medicineId: 'm1', onHand: 10, reserved: 0 });
  await assert.rejects(pharmacy.collection('inventory').insertOne({ id: 'i2', medicineId: 'm1', onHand: 10, reserved: 0 }), isDuplicate);
});

test('Pharmacy rejects negative stock, negative reserved, or reserved above onHand', async () => {
  for (const [onHand, reserved] of [[-1, 0], [10, -1], [1, 2]]) {
    await assert.rejects(pharmacy.collection('inventory').insertOne({ id: 'i1', medicineId: 'm1', onHand, reserved }), isInvalid);
  }
});

for (const fixture of [
  { collection: 'slots', db: () => appointment, fields: { scheduleId: 's1', startAt: new Date(), capacity: 1, heldCount: 0, confirmedCount: 0 } },
  { collection: 'holds', db: () => appointment, fields: { principalId: 'u1', idempotencyKey: 'k1', slotId: 's1', patientId: 'p1', expiresAt: new Date() } },
  { collection: 'inventory', db: () => pharmacy, fields: { medicineId: 'm1', onHand: 10, reserved: 0 } },
]) {
  test(`${fixture.collection} keeps the common non-empty scalar business-id constraint`, async () => {
    for (const id of [null, '', 7, []]) {
      await assert.rejects(fixture.db().collection(fixture.collection).insertOne({ ...fixture.fields, id }), isInvalid);
    }
  });
}

test('Pharmacy rejects a repeated stock receipt key', async () => {
  await pharmacy.collection('stock_receipts').insertOne({ id: 'r1', receiptKey: 'rk1' });
  await assert.rejects(pharmacy.collection('stock_receipts').insertOne({ id: 'r2', receiptKey: 'rk1' }), isDuplicate);
});

for (const collection of ['prescription_projection', 'medication_holds', 'dispenses']) {
  test(`Pharmacy deduplicates prescription/revision in ${collection}`, async () => {
    const c = pharmacy.collection(collection);
    await c.insertMany([
      { id: 'd1', prescriptionId: 'rx1', revision: 1, holdId: 'h1' },
      { id: 'd2', prescriptionId: 'rx1', revision: 2, holdId: 'h2' },
    ]);
    await assert.rejects(c.insertOne({ id: 'd3', prescriptionId: 'rx1', revision: 1, holdId: 'h3' }), isDuplicate);
  });
}

test('Pharmacy cannot dispense the same hold twice under different prescriptions', async () => {
  await pharmacy.collection('dispenses').insertOne({ id: 'd1', holdId: 'h1', prescriptionId: 'rx1', revision: 1 });
  await assert.rejects(pharmacy.collection('dispenses').insertOne({ id: 'd2', holdId: 'h1', prescriptionId: 'rx2', revision: 1 }), isDuplicate);
});

for (const [name, getDb] of [
  ['Patient', () => patient], ['Appointment', () => appointment], ['Pharmacy', () => pharmacy],
]) {
  test(`${name} inbox accepts different consumers but rejects repeat message/consumer`, async () => {
    const c = getDb().collection('inbox');
    await c.insertMany([{ message_id: 'msg1', consumer_name: 'c1' }, { message_id: 'msg1', consumer_name: 'c2' }]);
    await assert.rejects(c.insertOne({ message_id: 'msg1', consumer_name: 'c1' }), isDuplicate);
  });
  test(`${name} idempotency is scoped to principal, route and key`, async () => {
    const c = getDb().collection('idempotency_records');
    const row = { principal_id: 'u1', route: 'POST /resource', key: 'k1', request_hash: 'hash1' };
    await c.insertMany([{ ...row }, { ...row, principal_id: 'u2' }, { ...row, route: 'PATCH /resource/id' }]);
    await assert.rejects(c.insertOne({ ...row, request_hash: 'hash2' }), isDuplicate);
  });
  test(`${name} outbox cannot publish two records for the same message id`, async () => {
    const c = getDb().collection('outbox');
    await c.insertOne({ message_id: 'msg1' });
    await assert.rejects(c.insertOne({ message_id: 'msg1' }), isDuplicate);
  });
}

test('Storage bootstrap is repeatable without replacing existing data', async () => {
  await patient.collection('patients').insertOne({ id: 'p1', ownerUserId: 'u1' });
  await ensurePatientStorage(patientConnection); await ensureAppointmentStorage(appointmentConnection); await ensurePharmacyStorage(pharmacyConnection);
  assert.equal(await patient.collection('patients').countDocuments(), 1);
});

test('Transaction commits patient, audit and outbox together', async () => {
  const value = await withMongoTransaction(connection, async session => {
    await patient.collection('patients').insertOne({ id: 'p1', ownerUserId: 'u1' }, { session });
    await patient.collection('profile_audit').insertOne({ id: 'aud1', patientId: 'p1' }, { session });
    await patient.collection('outbox').insertOne({ message_id: 'msg1' }, { session });
    return 'committed';
  });
  assert.equal(value, 'committed');
  for (const name of ['patients', 'profile_audit', 'outbox']) assert.equal(await patient.collection(name).countDocuments(), 1);
});

test('Transaction abort rolls back patient, audit and outbox', async () => {
  await assert.rejects(withMongoTransaction(connection, async session => {
    await patient.collection('patients').insertOne({ id: 'p1', ownerUserId: 'u1' }, { session });
    await patient.collection('profile_audit').insertOne({ id: 'aud1', patientId: 'p1' }, { session });
    await patient.collection('outbox').insertOne({ message_id: 'msg1' }, { session });
    throw new Error('abort-marker');
  }), /abort-marker/);
  for (const name of ['patients', 'profile_audit', 'outbox']) assert.equal(await patient.collection(name).countDocuments(), 0);
});

test('Two concurrent transactions cannot reserve the last slot twice', async () => {
  const c = appointment.collection('slots');
  await c.insertOne({ id: 'sl1', scheduleId: 's1', startAt: new Date(), capacity: 1, heldCount: 0, confirmedCount: 0 });
  const reserve = () => withMongoTransaction(connection, async session => {
    const result = await c.updateOne({ id: 'sl1', $expr: { $lt: [{ $add: ['$heldCount', '$confirmedCount'] }, '$capacity'] } }, { $inc: { heldCount: 1 } }, { session });
    return result.modifiedCount;
  });
  const results = await Promise.all([reserve(), reserve()]);
  assert.equal(results.reduce((a,b) => a+b, 0), 1);
  assert.equal((await c.findOne({ id: 'sl1' }))?.heldCount, 1);
});

test('A failure on the second prescription line rolls back the first stock reservation', async () => {
  const c = pharmacy.collection('inventory');
  await c.insertMany([{ id: 'i1', medicineId: 'm1', onHand: 5, reserved: 0 }, { id: 'i2', medicineId: 'm2', onHand: 0, reserved: 0 }]);
  await assert.rejects(withMongoTransaction(connection, async session => {
    for (const medicineId of ['m1', 'm2']) {
      const result = await c.updateOne({ medicineId, $expr: { $gt: [{ $subtract: ['$onHand', '$reserved'] }, 0] } }, { $inc: { reserved: 1 } }, { session });
      if (!result.modifiedCount) throw new Error('insufficient-stock');
    }
  }), /insufficient-stock/);
  assert.equal((await c.findOne({ medicineId: 'm1' }))?.reserved, 0);
});

test('A duplicate outbox record aborts the corresponding domain write', async () => {
  await patient.collection('outbox').insertOne({ message_id: 'msg1' });
  await assert.rejects(withMongoTransaction(connection, async session => {
    await patient.collection('patients').insertOne({ id: 'p1', ownerUserId: 'u1' }, { session });
    await patient.collection('outbox').insertOne({ message_id: 'msg1' }, { session });
  }), isDuplicate);
  assert.equal(await patient.collection('patients').countDocuments(), 0);
});

for (const owner of ['patient', 'appointment', 'pharmacy']) {
test(`${owner} service user writes only its owner database`, async () => {
  const pwd = randomBytes(16).toString('hex');
  await provisionOwnerUser(connection, owner, pwd);
  const dbName = ownerDatabases[owner];
  const serviceClient = await mongoose.createConnection(server.getUri(), { dbName, auth: { username: `${owner}-service`, password: pwd }, authSource: dbName, autoCreate: false, autoIndex: false }).asPromise();
  try {
    await serviceClient.db.collection('owner_permission_probe').insertOne({ value: 'own-write' });
    const denied = (e) => e instanceof MongoServerError && e.code === 13;
    for (const other of Object.keys(ownerDatabases)) {
      if (other === owner) continue;
      const collection = serviceClient.useDb(ownerDatabases[other], { useCache: true }).db.collection('owner_permission_probe');
      await assert.rejects(collection.findOne({}), denied);
      await assert.rejects(collection.insertOne({ value: 'foreign-write' }), denied);
    }
  } finally { await serviceClient.close(); }
});
}

test('Transaction abort restores Mongoose document state so a failed create can be retried', async () => {
  const mongooseConnection = await mongoose.createConnection(server.getUri(), {
    dbName: 'patient_db', auth: { username: 'umc-test-root', password }, authSource: 'admin',
    autoCreate: false, autoIndex: false,
  }).asPromise();
  try {
    const schema = new mongoose.Schema({ id: { type: String, required: true }, ownerUserId: { type: String, required: true } }, {
      id: false, versionKey: false, collection: 'patients', autoCreate: false, autoIndex: false,
    });
    const Patient = mongooseConnection.model('TransactionPatient', schema);
    const doc = new Patient({ id: 'mongoose-patient', ownerUserId: 'u1' });
    await assert.rejects(withMongoTransaction(mongooseConnection, async session => {
      await doc.save({ session });
      throw new Error('mongoose-abort-marker');
    }), /mongoose-abort-marker/);
    assert.equal(await Patient.countDocuments({ id: 'mongoose-patient' }), 0);
    assert.equal(doc.isNew, true);
    await withMongoTransaction(mongooseConnection, async session => {
      await doc.save({ session });
    });
    assert.equal(await Patient.countDocuments({ id: 'mongoose-patient' }), 1);
  } finally { await mongooseConnection.close(); }
});
