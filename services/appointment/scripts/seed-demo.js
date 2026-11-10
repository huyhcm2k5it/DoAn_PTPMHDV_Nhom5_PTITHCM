const { connectDatabase } = require('../src/configs/database.js');
const {
  getScheduleModel,
  getSlotModel,
} = require('../src/models/appointment.model.js');
const { ensureAppointmentStorage } = require('../src/dbs/indexes.js');

const ids = {
  ownerA: '11111111-1111-4111-8111-111111111111',
  ownerB: '22222222-2222-4222-8222-222222222222',
  patientA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  patientB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  doctor: '00000000-0000-4000-8000-000000000101',
  service: '00000000-0000-4000-8000-000000000201',
  schedule: '00000000-0000-4000-8000-000000000501',
  slot: '00000000-0000-4000-8000-000000000601',
};

async function seed({
  uri = process.env.MONGODB_URI,
  now = new Date(),
  demoDate = process.env.DEMO_APPOINTMENT_DATE,
  dryRun = process.argv.includes('--dry-run'),
} = {}) {
  const vietnamTomorrow = new Date(
    now.getTime() + 24 * 60 * 60 * 1000,
  ).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const selectedDate = demoDate || vietnamTomorrow;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate))
    throw new Error('DEMO_APPOINTMENT_DATE must be YYYY-MM-DD.');
  const startAt = new Date(`${selectedDate}T08:00:00+07:00`);
  const endAt = new Date(`${selectedDate}T10:00:00+07:00`);
  const slotEndAt = new Date(`${selectedDate}T08:30:00+07:00`);
  const records = {
    schedule: {
      id: ids.schedule,
      doctorId: ids.doctor,
      serviceId: ids.service,
      room: 'A-101',
      startAt,
      endAt,
      capacityPerSlot: 1,
      status: 'OPEN',
      slotMinutes: 30,
      version: 1,
    },
    slot: {
      id: ids.slot,
      scheduleId: ids.schedule,
      startAt,
      endAt: slotEndAt,
      capacity: 1,
      heldCount: 0,
      confirmedCount: 0,
    },
    access: [
      {
        userId: ids.ownerA,
        actorType: 'PATIENT',
        capabilities: [],
        status: 'ACTIVE',
        tokenVersion: 1,
        policyVersion: 1,
      },
      {
        userId: ids.ownerB,
        actorType: 'PATIENT',
        capabilities: [],
        status: 'ACTIVE',
        tokenVersion: 1,
        policyVersion: 1,
      },
    ],
    patientAccess: [
      {
        patientId: ids.patientA,
        ownerUserId: ids.ownerA,
        active: true,
        policyVersion: 1,
      },
      {
        patientId: ids.patientB,
        ownerUserId: ids.ownerB,
        active: true,
        policyVersion: 1,
      },
    ],
  };
  if (dryRun) return records;
  if (!uri) throw new Error('MONGODB_URI is required');
  const connection = await connectDatabase(uri);
  try {
    await ensureAppointmentStorage(connection);
    const Schedule = getScheduleModel(connection);
    const Slot = getSlotModel(connection);
    await Schedule.updateOne(
      { id: records.schedule.id },
      { $setOnInsert: records.schedule },
      { upsert: true },
    );
    await Slot.updateOne(
      { id: records.slot.id },
      { $setOnInsert: records.slot },
      { upsert: true },
    );
    for (const projection of records.access)
      await connection
        .collection('user_access_projection')
        .updateOne(
          { userId: projection.userId },
          { $setOnInsert: { ...projection, updatedAt: now } },
          { upsert: true },
        );
    for (const projection of records.patientAccess)
      await connection
        .collection('patient_access_projection')
        .updateOne(
          { patientId: projection.patientId },
          { $setOnInsert: { ...projection, updatedAt: now } },
          { upsert: true },
        );
    return records;
  } finally {
    await connection.close();
  }
}

if (require.main === module)
  seed()
    .then(() => console.log('appointment demo seed ready'))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { ids, seed };
