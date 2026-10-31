const { connectDatabase } = require('../src/configs/database.js');
const { getScheduleModel, getSlotModel } = require('../src/models/appointment.model.js');

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
  dryRun = process.argv.includes('--dry-run'),
} = {}) {
  const records = {
    schedule: {
      id: ids.schedule,
      doctorId: ids.doctor,
      serviceId: ids.service,
      room: 'A-101',
      startAt: new Date('2026-11-02T01:00:00.000Z'),
      endAt: new Date('2026-11-02T03:00:00.000Z'),
      capacityPerSlot: 1,
      status: 'OPEN',
      slotMinutes: 30,
      version: 1,
    },
    slot: {
      id: ids.slot,
      scheduleId: ids.schedule,
      startAt: new Date('2026-11-02T01:00:00.000Z'),
      endAt: new Date('2026-11-02T01:30:00.000Z'),
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
      { patientId: ids.patientA, ownerUserId: ids.ownerA, active: true, policyVersion: 1 },
      { patientId: ids.patientB, ownerUserId: ids.ownerB, active: true, policyVersion: 1 },
    ],
  };
  if (dryRun) return records;
  if (!uri) throw new Error('MONGODB_URI is required');
  const connection = await connectDatabase(uri);
  try {
    const Schedule = getScheduleModel(connection);
    const Slot = getSlotModel(connection);
    await Schedule.replaceOne(
      { id: records.schedule.id },
      { ...records.schedule, updatedAt: now },
      { upsert: true },
    );
    await Slot.replaceOne({ id: records.slot.id }, records.slot, { upsert: true });
    for (const projection of records.access)
      await connection
        .collection('user_access_projection')
        .replaceOne(
          { userId: projection.userId },
          { ...projection, updatedAt: now },
          { upsert: true },
        );
    for (const projection of records.patientAccess)
      await connection
        .collection('patient_access_projection')
        .replaceOne(
          { patientId: projection.patientId },
          { ...projection, updatedAt: now },
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
