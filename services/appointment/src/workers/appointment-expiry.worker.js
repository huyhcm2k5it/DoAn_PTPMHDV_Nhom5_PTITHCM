const {
  getAppointmentRepository,
} = require('../services/appointment.repository');
const { randomUUID } = require('node:crypto');
const { ApiError } = require('../core/errors');
const {
  refreshPatientIntervals,
} = require('../services/patient-time-lock.service');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const {
  getSlotModel,
  getOutboxModel,
} = require('../models/appointment.model.js');

async function expirePendingAppointments({
  connection,
  now = new Date(),
  batchSize = 100,
  createId = randomUUID,
}) {
  const Appointment = getAppointmentRepository(connection);
  const candidates = await Appointment.find({
    state: 'PENDING_PAYMENT',
    $or: [
      { expiresAt: { $lte: now } },
      { expiresAt: { $exists: false }, paymentDueAt: { $lte: now } },
    ],
  })
    .sort({ expiresAt: 1, paymentDueAt: 1 })
    .limit(batchSize)
    .lean();
  let expired = 0;
  for (const candidate of candidates) {
    await withMongoTransaction(connection, async (session) => {
      const access = await connection
        .collection('patient_access_projection')
        .findOne({ patientId: candidate.patientId, active: true }, { session });
      const recipientUserId = access?.ownerUserId ?? candidate.recipientUserId;
      if (!recipientUserId)
        throw new ApiError(
          503,
          'AUTH_PROJECTION_UNAVAILABLE',
          'Expiry recipient is unavailable.',
        );
      const cancellationId = createId();
      const changed = await Appointment.updateOne(
        {
          id: candidate.id,
          state: 'PENDING_PAYMENT',
          version: candidate.version,
        },
        {
          $set: { state: 'EXPIRED', cancellationId, updatedAt: now },
          $push: {
            stateHistory: {
              state: 'EXPIRED',
              at: now,
              reasonCode: 'PAYMENT_TIMEOUT',
            },
          },
          $inc: { version: 1 },
        },
        { session },
      );
      if (!changed.modifiedCount) return;
      const Slot = getSlotModel(connection);
      const released = await Slot.updateOne(
        { id: candidate.slotId, heldCount: { $gt: 0 } },
        { $inc: { heldCount: -1, version: 1 } },
        { session },
      );
      if (!released.modifiedCount) throw new Error('CAPACITY_INVARIANT_BROKEN');
      await refreshPatientIntervals(connection, candidate.patientId, session);
      const Outbox = getOutboxModel(connection);
      await Outbox.create(
        [
          {
            message_id: createId(),
            message_kind: 'EVENT',
            message_type: 'AppointmentChanged',
            schema_version: 1,
            producer: 'appointment',
            aggregate_id: candidate.id,
            aggregate_version: candidate.version + 1,
            correlation_id: candidate.requestId,
            occurred_at: now,
            payload: {
              appointmentId: candidate.id,
              patientId: candidate.patientId,
              recipientUserId,
              changeType: 'EXPIRED',
              version: candidate.version + 1,
              cancellationId,
              reasonCode: 'PAYMENT_TIMEOUT',
              sourceType: 'APPOINTMENT',
              sourceId: candidate.id,
              sourceRevision: candidate.sourceRevision,
              state: 'EXPIRED',
            },
          },
        ],
        { session },
      );
      expired += 1;
    });
  }
  return expired;
}

module.exports = { expirePendingAppointments };

// Cache invalidation runs after successful transaction commit.
module.exports.expirePendingAppointments = async (...args) => {
  const result = await expirePendingAppointments(...args);
  await require('../services/slot-cache.service').getSlotCache().invalidate();
  return result;
};
