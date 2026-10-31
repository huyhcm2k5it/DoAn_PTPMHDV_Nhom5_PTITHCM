const { randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const { getAppointmentModel, getSlotModel, getOutboxModel } = require('../models/appointment.model.js');

async function expirePendingAppointments({ connection, now = new Date(), batchSize = 100, createId = randomUUID }) {
  const Appointment = getAppointmentModel(connection);
  const candidates = await Appointment.find({ state: 'PENDING_PAYMENT', paymentDueAt: { $lte: now } }).sort({ paymentDueAt: 1 }).limit(batchSize).lean();
  let expired = 0;
  for (const candidate of candidates) {
    await withMongoTransaction(connection, async (session) => {
      const changed = await Appointment.updateOne({ id: candidate.id, state: 'PENDING_PAYMENT', version: candidate.version }, { $set: { state: 'EXPIRED', updatedAt: now, chargeStatus: 'EXPIRED' }, $inc: { version: 1 } }, { session });
      if (!changed.modifiedCount) return;
      const Slot = getSlotModel(connection);
      const released = await Slot.updateOne({ id: candidate.slotId, heldCount: { $gt: 0 } }, { $inc: { heldCount: -1 } }, { session });
      if (!released.modifiedCount) throw new Error('CAPACITY_INVARIANT_BROKEN');
      const Outbox = getOutboxModel(connection);
      await Outbox.create([{ message_id: createId(), message_kind: 'EVENT', message_type: 'AppointmentChanged', schema_version: 1, producer: 'Appointment', aggregate_id: candidate.id, aggregate_version: candidate.version + 1, correlation_id: candidate.requestId, occurred_at: now, payload: { sourceType: 'APPOINTMENT', sourceId: candidate.id, sourceRevision: candidate.sourceRevision, state: 'EXPIRED', reason: 'PAYMENT_TIMEOUT' } }], { session });
      expired += 1;
    });
  }
  return expired;
}

module.exports = { expirePendingAppointments };
