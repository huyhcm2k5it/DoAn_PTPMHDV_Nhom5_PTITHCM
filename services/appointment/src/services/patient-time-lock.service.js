const {
  getAppointmentModel,
  getHoldModel,
  getSlotModel,
  getPatientTimeLockModel,
} = require('../models/appointment.model');

const activeAppointmentStates = [
  'PENDING_PAYMENT',
  'SETTLEMENT_LOCKED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_SERVICE',
];

async function refreshPatientIntervals(connection, patientId, session) {
  const holds = await getHoldModel(connection)
    .find({ patientId, status: 'HELD' })
    .select('id slotId')
    .session(session)
    .lean();
  const appointments = await getAppointmentModel(connection)
    .find({ patientId, state: { $in: activeAppointmentStates } })
    .select('id holdId startAt endAt state')
    .session(session)
    .lean();
  const slots = await getSlotModel(connection).find({ id: { $in: holds.map((hold) => hold.slotId) } }).session(session).lean();
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  if (holds.some((hold) => !slotById.has(hold.slotId))) throw new Error('Active hold references a missing slot.');
  const intervals = holds
    .map((hold) => ({
      holdId: hold.id,
      startAt: slotById.get(hold.slotId)?.startAt,
      endAt: slotById.get(hold.slotId)?.endAt,
      state: 'HELD',
    }))
    .concat(
      appointments.map((appointment) => ({
        holdId: appointment.holdId,
        appointmentId: appointment.id,
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        state: appointment.state,
      })),
    )
    .sort((left, right) => left.startAt - right.startAt);
  await getPatientTimeLockModel(connection).updateOne(
    { patientId },
    { $set: { intervals }, $inc: { version: 1 } },
    { upsert: true, session, runValidators: true },
  );
}

module.exports = { refreshPatientIntervals };
