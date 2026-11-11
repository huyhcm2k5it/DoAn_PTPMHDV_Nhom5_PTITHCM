const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { buildDataset } = require('../../tools/quan/demo-dataset');
const {
  applyDataset,
  validateTargets,
} = require('../../tools/quan/seed-atlas-demo');
const {
  getPatientModel,
} = require('../../services/patient/src/models/patient.model');
const {
  getScheduleModel,
  getSlotModel,
} = require('../../services/appointment/src/models/appointment.model');

const options = {
  startDate: '2026-11-11',
  patientCount: 8,
  doctorCount: 2,
  days: 2,
  medicineCount: 3,
};
let server;
const connections = {};
before(
  async () => {
    server = await MongoMemoryReplSet.create({
      binary: { version: '8.0.16' },
      replSet: { count: 1 },
    });
    for (const owner of ['patient', 'appointment', 'pharmacy']) {
      connections[owner] = await mongoose
        .createConnection(server.getUri(owner + '_db'), {
          autoCreate: false,
          autoIndex: false,
          runtimeAdapters: { os: require('node:os') },
        })
        .asPromise();
    }
  },
  { timeout: 120000 },
);
after(async () => {
  await Promise.all(
    Object.values(connections).map((connection) => connection.close()),
  );
  await server?.stop();
});

test('demo builder produces reproducible linked data with unique UUIDs and no fabricated payments/access', () => {
  const data = buildDataset(options);
  assert.deepEqual(data, buildDataset(options));
  const patients = data.collections.patient.patients;
  const schedules = data.collections.appointment.schedules;
  const slots = data.collections.appointment.slots;
  assert.equal(patients.length, 8);
  assert.equal(schedules.length, 8);
  assert.equal(slots.length, 64);
  const scheduleMap = new Map(schedules.map((row) => [row.id, row]));
  for (const row of slots) {
    const schedule = scheduleMap.get(row.scheduleId);
    assert.ok(schedule);
    assert.ok(row.startAt >= schedule.startAt && row.endAt <= schedule.endAt);
    assert.equal(row.heldCount + row.confirmedCount, 0);
    assert.ok(row.capacity > 0);
  }
  for (const collections of Object.values(data.collections)) {
    for (const [name, rows] of Object.entries(collections)) {
      const ids = rows.map((row) => row.id || row.entityKey);
      assert.equal(new Set(ids).size, ids.length, name);
      assert.ok(
        ![
          'outbox',
          'user_access_projection',
          'projection_checkpoints',
          'appointments',
          'dispenses',
          'prescription_projection',
        ].includes(name),
      );
    }
  }
  assert.ok(
    patients.every(
      (row) =>
        row.fullName.startsWith('DEMO ') && row.contactPhone.startsWith('000'),
    ),
  );
  assert.ok(
    data.collections.pharmacy.inventory.every(
      (row) => row.reserved === 0 && row.onHand >= 0,
    ),
  );
  assert.ok(
    data.collections.pharmacy.catalog_projection.every(
      (row) => row.source === 'DEMO_FIXTURE',
    ),
  );
});

test('demo rows satisfy strict owner Mongoose models and stay within 30-day display range', () => {
  const data = buildDataset(options);
  const Patient = getPatientModel(connections.patient);
  const Schedule = getScheduleModel(connections.appointment);
  const Slot = getSlotModel(connections.appointment);
  for (const row of data.collections.patient.patients)
    assert.equal(new Patient(row).validateSync(), undefined);
  for (const row of data.collections.appointment.schedules)
    assert.equal(new Schedule(row).validateSync(), undefined);
  for (const row of data.collections.appointment.slots)
    assert.equal(new Slot(row).validateSync(), undefined);
  const full = buildDataset({ startDate: options.startDate });
  assert.equal(full.collections.patient.patients.length, 5000);
  assert.equal(full.collections.appointment.schedules.length, 1800);
  assert.equal(full.collections.appointment.slots.length, 14400);
  assert.equal(full.collections.pharmacy.inventory.length, 300);
  assert.throws(() => buildDataset({ startDate: '2026-02-30' }), /date/i);
  assert.throws(
    () => buildDataset({ startDate: options.startDate, patientCount: -1 }),
    /patientCount/,
  );
});

test('online target guard rejects wrong database and unapproved hosts before writes', () => {
  const env = {
    PATIENT_MONGO_URI:
      'mongodb+srv://user:secret@cluster0.8a2ahrj.mongodb.net/patient_db',
    APPOINTMENT_MONGO_URI:
      'mongodb+srv://user:secret@cluster0.jmwxgbh.mongodb.net/appointment_db',
    PHARMACY_MONGO_URI:
      'mongodb+srv://user:secret@cluster0.qbu6p35.mongodb.net/pharmacy_db',
  };
  assert.equal(validateTargets(env).length, 3);
  assert.throws(
    () =>
      validateTargets({
        ...env,
        PATIENT_MONGO_URI: env.PATIENT_MONGO_URI.replace(
          'patient_db',
          'production',
        ),
      }),
    /database/i,
  );
  assert.throws(
    () =>
      validateTargets({
        ...env,
        PATIENT_MONGO_URI: env.PATIENT_MONGO_URI.replace(
          'cluster0.8a2ahrj',
          'other',
        ),
      }),
    /host/i,
  );
});

test('seed rerun inserts nothing, preserves changed business rows, and rejects a changed batch configuration', async () => {
  const data = buildDataset(options);
  const first = await applyDataset(connections, data);
  assert.ok(first.inserted > 0);
  const patient = data.collections.patient.patients[0];
  await connections.patient
    .collection('patients')
    .updateOne(
      { id: patient.id },
      { $set: { fullName: 'Edited after seed', version: 2 } },
    );
  const second = await applyDataset(connections, data);
  assert.equal(second.inserted, 0);
  assert.equal(
    (
      await connections.patient
        .collection('patients')
        .findOne({ id: patient.id })
    ).fullName,
    'Edited after seed',
  );
  assert.equal(
    await connections.pharmacy.collection('stock_receipts').countDocuments(),
    options.medicineCount,
  );
  assert.equal(
    await connections.appointment.collection('outbox').countDocuments(),
    0,
  );
  await assert.rejects(
    () =>
      applyDataset(connections, buildDataset({ ...options, patientCount: 9 })),
    /configuration/i,
  );
  assert.equal(
    await connections.patient.collection('patients').countDocuments(),
    options.patientCount,
  );
});
