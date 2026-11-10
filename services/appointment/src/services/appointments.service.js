const { createHash, randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const {
  getHoldModel,
  getScheduleModel,
  getSlotModel,
  getAppointmentModel,
  getPatientTimeLockModel,
  getIdempotencyModel,
  getOutboxModel,
} = require('../models/appointment.model.js');
const { ApiError } = require('../core/errors.js');
const { requestHash } = require('./holds.service.js');

function responseForAppointment(appointment) {
  return {
    requestId: appointment.requestId,
    appointmentId: appointment.id,
    state: appointment.state,
    statusUrl: '/api/v1/appointments/' + appointment.id,
  };
}
function assertUuid(value, field) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value || '',
    )
  )
    throw new ApiError(400, 'VALIDATION_ERROR', field + ' must be a UUID.');
}
async function existingIdempotency(Idempotency, principalId, route, key, hash) {
  const row = await Idempotency.findOne({
    principal_id: principalId,
    route,
    key,
  }).lean();
  if (!row) return null;
  if (row.request_hash !== hash)
    throw new ApiError(
      409,
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency-Key đã được dùng với payload khác.',
    );
  return row.response;
}

async function createAppointment({
  connection,
  principalId,
  patientId,
  holdId,
  idempotencyKey,
  correlationId = randomUUID(),
  now = new Date(),
  createId = randomUUID,
}) {
  assertUuid(patientId, 'patientId');
  if (!holdId || !principalId || !idempotencyKey)
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'holdId, patientId and Idempotency-Key are required.',
    );
  const route = 'POST /api/v1/appointments';
  const hash = requestHash({ holdId, patientId });
  const Hold = getHoldModel(connection);
  const Slot = getSlotModel(connection);
  const Appointment = getAppointmentModel(connection);
  const Idempotency = getIdempotencyModel(connection);
  const Outbox = getOutboxModel(connection);
  const replay = await existingIdempotency(
    Idempotency,
    principalId,
    route,
    idempotencyKey,
    hash,
  );
  if (replay) return replay;
  try {
    return await withMongoTransaction(connection, async (session) => {
      const hold = await Hold.findOne({ id: holdId }).session(session).lean();
      if (!hold)
        throw new ApiError(404, 'HOLD_NOT_FOUND', 'Hold không tồn tại.');
      if (hold.principalId !== principalId || hold.patientId !== patientId)
        throw new ApiError(403, 'FORBIDDEN', 'Không có quyền trên hold này.');
      if (hold.status !== 'HELD')
        throw new ApiError(
          409,
          hold.status === 'EXPIRED' ? 'HOLD_EXPIRED' : 'HOLD_ALREADY_CONSUMED',
          'Hold không còn hiệu lực.',
        );
      if (hold.expiresAt <= now)
        throw new ApiError(409, 'HOLD_EXPIRED', 'Hold đã hết hạn.');
      if (
        !hold.priceSnapshot ||
        hold.priceSnapshot.amountVnd == null ||
        !hold.priceSnapshot.snapshotHash
      )
        throw new ApiError(
          503,
          'PRICE_PROJECTION_STALE',
          'Chưa có giá đã xác nhận để tạo lịch.',
        );
      const appointmentId = createId();
      const requestId = createId();
      const changed = await Hold.updateOne(
        {
          id: holdId,
          status: 'HELD',
          version: hold.version,
          expiresAt: { $gt: now },
        },
        { $set: { status: 'CONSUMED' }, $inc: { version: 1 } },
        { session },
      );
      if (!changed.modifiedCount)
        throw new ApiError(
          409,
          'HOLD_EXPIRED',
          'Hold đã hết hạn hoặc đã được tiêu thụ.',
        );
      const slot = await Slot.findOne({ id: hold.slotId })
        .session(session)
        .lean();
      if (!slot)
        throw new ApiError(404, 'SLOT_NOT_FOUND', 'Slot không tồn tại.');
      const appointment = {
        id: appointmentId,
        requestId,
        sourceRevision: 1,
        holdId,
        patientId,
        principalId,
        slotId: hold.slotId,
        scheduleId: hold.scheduleId,
        doctorId: hold.doctorId,
        doctorUserId: hold.doctorUserId,
        departmentId: hold.departmentId,
        serviceId: hold.serviceId,
        startAt: hold.slotStartAt,
        endAt: hold.slotEndAt,
        state: 'PENDING_PAYMENT',
        stateHistory: [{ state: 'PENDING_PAYMENT', at: now }],
        chargeSync: 'PENDING',
        priceSnapshot: hold.priceSnapshot || null,
        paymentDueAt: new Date(now.getTime() + 10 * 60 * 1000),
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await Appointment.create([appointment], { session });
      const messageId = createId();
      await Outbox.create(
        [
          {
            message_id: messageId,
            message_kind: 'COMMAND',
            message_type: 'RequestCharge',
            schema_version: 1,
            producer: 'appointment',
            aggregate_id: appointmentId,
            aggregate_version: 1,
            correlation_id: correlationId,
            occurred_at: now,
            payload: {
              requestId,
              sourceType: 'APPOINTMENT',
              sourceId: appointmentId,
              sourceRevision: 1,
              patientId,
              linesSnapshot: hold.priceSnapshot ? [hold.priceSnapshot] : [],
              amountVnd: hold.priceSnapshot?.amountVnd ?? null,
              snapshotHash: hold.priceSnapshot?.snapshotHash ?? null,
            },
          },
        ],
        { session },
      );
      const response = responseForAppointment(appointment);
      await Idempotency.create(
        [
          {
            principal_id: principalId,
            route,
            key: idempotencyKey,
            request_hash: hash,
            response,
            created_at: now,
          },
        ],
        { session },
      );
      return response;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const replayAfterRace = await existingIdempotency(
        Idempotency,
        principalId,
        route,
        idempotencyKey,
        hash,
      );
      if (replayAfterRace) return replayAfterRace;
    }
    throw error;
  }
}

async function getAppointment({ connection, appointmentId, principalId }) {
  const Appointment = getAppointmentModel(connection);
  const appointment = await Appointment.findOne({
    id: appointmentId,
    ...(principalId ? { principalId } : {}),
  }).lean();
  if (!appointment)
    throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy lịch hẹn.');
  return {
    appointment,
    chargeStatus: appointment.chargeStatus || 'PENDING',
    refundStatus: appointment.refundStatus || null,
    chargeSync: appointment.chargeSync,
  };
}
async function listPatientAppointments({
  connection,
  patientId,
  principalId,
  state,
  from,
  to,
  page = 1,
  limit = 20,
}) {
  assertUuid(patientId, 'patientId');
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);
  if (
    !Number.isInteger(parsedPage) ||
    parsedPage < 1 ||
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > 100
  )
    throw new ApiError(400, 'VALIDATION_ERROR', 'page/limit invalid.');
  const query = { patientId, ...(principalId ? { principalId } : {}) };
  if (state) query.state = state;
  if (from || to)
    query.startAt = {
      ...(from ? { $gte: new Date(from + 'T00:00:00+07:00') } : {}),
      ...(to ? { $lt: new Date(to + 'T00:00:00+07:00') } : {}),
    };
  const Appointment = getAppointmentModel(connection);
  const [items, total] = await Promise.all([
    Appointment.find(query)
      .sort({ startAt: 1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .lean(),
    Appointment.countDocuments(query),
  ]);
  return { items, total, page: parsedPage, limit: parsedLimit };
}

function assertExpectedVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1)
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'expectedVersion must be a positive integer.',
    );
  return version;
}

function responseForChange(appointment) {
  return {
    appointmentId: appointment.id,
    state: appointment.state,
    version: appointment.version,
    slotHistory: appointment.slotHistory || [],
    refundStatus: appointment.refundStatus || 'NONE',
    cancellationId: appointment.cancellationId || null,
  };
}

async function rescheduleAppointment({
  connection,
  appointmentId,
  principalId,
  patientId,
  newSlotId,
  expectedVersion,
  idempotencyKey,
  correlationId = randomUUID(),
  now = new Date(),
  resolvePriceSnapshot = async () => null,
  createId = randomUUID,
}) {
  if (
    !appointmentId ||
    !principalId ||
    !patientId ||
    !newSlotId ||
    !idempotencyKey
  )
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'newSlotId, expectedVersion and Idempotency-Key are required.',
    );
  const version = assertExpectedVersion(expectedVersion);
  const route = `POST /api/v1/appointments/${appointmentId}/reschedule`;
  const hash = requestHash({ newSlotId, expectedVersion: version });
  const Appointment = getAppointmentModel(connection);
  const Schedule = getScheduleModel(connection);
  const Slot = getSlotModel(connection);
  const Lock = getPatientTimeLockModel(connection);
  const Idempotency = getIdempotencyModel(connection);
  const Outbox = getOutboxModel(connection);
  const replay = await existingIdempotency(
    Idempotency,
    principalId,
    route,
    idempotencyKey,
    hash,
  );
  if (replay) return replay;
  try {
    return await withMongoTransaction(connection, async (session) => {
      const appointment = await Appointment.findOne({
        id: appointmentId,
        patientId,
      })
        .session(session)
        .lean();
      if (!appointment)
        throw new ApiError(404, 'NOT_FOUND', 'Appointment not found.');
      if (appointment.version !== version)
        throw new ApiError(409, 'VERSION_CONFLICT', 'Appointment changed.');
      if (appointment.state !== 'CONFIRMED')
        throw new ApiError(
          409,
          'APPOINTMENT_STATE_CONFLICT',
          'Only confirmed appointments can be rescheduled.',
        );
      if (appointment.startAt.getTime() - now.getTime() < 2 * 60 * 60 * 1000)
        throw new ApiError(
          409,
          'RESCHEDULE_WINDOW_CLOSED',
          'Rescheduling closes two hours before the appointment.',
        );
      if (newSlotId === appointment.slotId)
        throw new ApiError(
          409,
          'SLOT_UNAVAILABLE',
          'The new slot must differ from the current slot.',
        );
      const slot = await Slot.findOne({ id: newSlotId })
        .session(session)
        .lean();
      if (!slot)
        throw new ApiError(404, 'SLOT_NOT_FOUND', 'New slot not found.');
      const schedule = await Schedule.findOne({
        id: slot.scheduleId,
        status: 'OPEN',
      })
        .session(session)
        .lean();
      if (
        !schedule ||
        schedule.doctorId !== appointment.doctorId ||
        schedule.serviceId !== appointment.serviceId
      )
        throw new ApiError(
          409,
          'SLOT_DOCTOR_OR_SERVICE_MISMATCH',
          'New slot must keep doctor and service.',
        );
      const priceSnapshot = await resolvePriceSnapshot({
        slot,
        schedule,
        now,
        session,
      });
      if (!priceSnapshot)
        throw new ApiError(
          503,
          'PRICE_PROJECTION_STALE',
          'New slot price projection is unavailable.',
        );
      if (
        priceSnapshot.snapshotHash !==
          appointment.priceSnapshot?.snapshotHash ||
        Number(priceSnapshot.amountVnd) !==
          Number(appointment.priceSnapshot?.amountVnd)
      )
        throw new ApiError(
          409,
          'PRICE_CHANGED',
          'New slot does not have the accepted price snapshot.',
        );
      if (slot.startAt <= now)
        throw new ApiError(409, 'SLOT_UNAVAILABLE', 'New slot is in the past.');
      await Lock.updateOne(
        { patientId },
        { $set: { updatedAt: now }, $inc: { version: 1 } },
        { upsert: true, session },
      );
      const [activeHold, activeAppointment] = await Promise.all([
        getHoldModel(connection)
          .findOne({
            patientId,
            status: 'HELD',
            expiresAt: { $gt: now },
            slotStartAt: { $lt: slot.endAt },
            slotEndAt: { $gt: slot.startAt },
          })
          .session(session)
          .lean(),
        Appointment.findOne({
          patientId,
          id: { $ne: appointmentId },
          state: {
            $in: [
              'PENDING_PAYMENT',
              'SETTLEMENT_LOCKED',
              'CONFIRMED',
              'CHECKED_IN',
              'IN_SERVICE',
            ],
          },
          startAt: { $lt: slot.endAt },
          endAt: { $gt: slot.startAt },
        })
          .session(session)
          .lean(),
      ]);
      if (activeHold || activeAppointment)
        throw new ApiError(
          409,
          'PATIENT_TIME_CONFLICT',
          'New slot overlaps another patient booking.',
        );
      const reserved = await Slot.updateOne(
        {
          id: newSlotId,
          $expr: {
            $lt: [{ $add: ['$heldCount', '$confirmedCount'] }, '$capacity'],
          },
        },
        { $inc: { confirmedCount: 1 } },
        { session },
      );
      if (!reserved.modifiedCount)
        throw new ApiError(409, 'SLOT_FULL', 'New slot is full.');
      const nextVersion = version + 1;
      const slotHistory = [
        ...(appointment.slotHistory || []),
        {
          fromSlotId: appointment.slotId,
          toSlotId: newSlotId,
          changedAt: now,
          reason: 'RESCHEDULED',
          version: nextVersion,
        },
      ];
      const changed = await Appointment.updateOne(
        { id: appointmentId, state: 'CONFIRMED', version },
        {
          $set: {
            slotId: newSlotId,
            scheduleId: slot.scheduleId,
            startAt: slot.startAt,
            endAt: slot.endAt,
            slotHistory,
            updatedAt: now,
          },
          $inc: { version: 1, sourceRevision: 1 },
        },
        { session },
      );
      if (!changed.modifiedCount)
        throw new ApiError(409, 'VERSION_CONFLICT', 'Appointment changed.');
      const released = await Slot.updateOne(
        { id: appointment.slotId, confirmedCount: { $gt: 0 } },
        { $inc: { confirmedCount: -1 } },
        { session },
      );
      if (!released.modifiedCount)
        throw new ApiError(
          500,
          'CAPACITY_INVARIANT_BROKEN',
          'Old slot cannot be released.',
        );
      const updated = {
        ...appointment,
        slotId: newSlotId,
        scheduleId: slot.scheduleId,
        startAt: slot.startAt,
        endAt: slot.endAt,
        slotHistory,
        version: nextVersion,
        sourceRevision: appointment.sourceRevision + 1,
      };
      const response = responseForChange(updated);
      await Outbox.create(
        [
          {
            message_id: createId(),
            message_kind: 'EVENT',
            message_type: 'AppointmentChanged',
            schema_version: 1,
            producer: 'appointment',
            aggregate_id: appointmentId,
            aggregate_version: nextVersion,
            correlation_id: correlationId,
            occurred_at: now,
            payload: {
              sourceType: 'APPOINTMENT',
              sourceId: appointmentId,
              appointmentId,
              patientId: appointment.patientId,
              recipientUserId: appointment.principalId,
              sourceRevision: updated.sourceRevision,
              state: 'CONFIRMED',
              changeType: 'RESCHEDULED',
              version: nextVersion,
              reasonCode: 'RESCHEDULED',
              oldSlotId: appointment.slotId,
              newSlotId,
            },
          },
        ],
        { session },
      );
      await Idempotency.create(
        [
          {
            principal_id: principalId,
            route,
            key: idempotencyKey,
            request_hash: hash,
            response,
            created_at: now,
          },
        ],
        { session },
      );
      return response;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const replayAfterRace = await existingIdempotency(
        Idempotency,
        principalId,
        route,
        idempotencyKey,
        hash,
      );
      if (replayAfterRace) return replayAfterRace;
    }
    throw error;
  }
}

async function cancelAppointment({
  connection,
  appointmentId,
  principalId,
  patientId,
  reasonCode,
  expectedVersion,
  idempotencyKey,
  correlationId = randomUUID(),
  now = new Date(),
  createId = randomUUID,
}) {
  if (
    !appointmentId ||
    !principalId ||
    !patientId ||
    !reasonCode ||
    !idempotencyKey
  )
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'reasonCode, expectedVersion and Idempotency-Key are required.',
    );
  const version = assertExpectedVersion(expectedVersion);
  const route = `POST /api/v1/appointments/${appointmentId}/cancel`;
  const hash = requestHash({ reasonCode, expectedVersion: version });
  const Appointment = getAppointmentModel(connection);
  const Slot = getSlotModel(connection);
  const Idempotency = getIdempotencyModel(connection);
  const Outbox = getOutboxModel(connection);
  const replay = await existingIdempotency(
    Idempotency,
    principalId,
    route,
    idempotencyKey,
    hash,
  );
  if (replay) return replay;
  try {
    return await withMongoTransaction(connection, async (session) => {
      const appointment = await Appointment.findOne({
        id: appointmentId,
        patientId,
      })
        .session(session)
        .lean();
      if (!appointment)
        throw new ApiError(404, 'NOT_FOUND', 'Appointment not found.');
      if (appointment.version !== version)
        throw new ApiError(409, 'VERSION_CONFLICT', 'Appointment changed.');
      if (!['PENDING_PAYMENT', 'CONFIRMED'].includes(appointment.state))
        throw new ApiError(
          409,
          'APPOINTMENT_STATE_CONFLICT',
          'Appointment cannot be cancelled in its current state.',
        );
      if (appointment.startAt.getTime() - now.getTime() < 2 * 60 * 60 * 1000)
        throw new ApiError(
          409,
          'CANCELLATION_WINDOW_CLOSED',
          'Cancellation closes two hours before the appointment.',
        );
      const cancellationId = createId();
      const refundStatus =
        appointment.chargeStatus === 'PAID' ? 'REQUESTED' : 'NONE';
      const released = await Slot.updateOne(
        {
          id: appointment.slotId,
          [appointment.state === 'CONFIRMED' ? 'confirmedCount' : 'heldCount']:
            { $gt: 0 },
        },
        {
          $inc: {
            [appointment.state === 'CONFIRMED'
              ? 'confirmedCount'
              : 'heldCount']: -1,
          },
        },
        { session },
      );
      if (!released.modifiedCount)
        throw new ApiError(
          500,
          'CAPACITY_INVARIANT_BROKEN',
          'Slot cannot be released.',
        );
      const nextVersion = version + 1;
      const changed = await Appointment.updateOne(
        { id: appointmentId, state: appointment.state, version },
        {
          $set: {
            state: 'CANCELLED',
            refundStatus,
            cancellationId,
            cancelledAt: now,
            updatedAt: now,
          },
          $push: { stateHistory: { state: 'CANCELLED', at: now, reasonCode } },
          $inc: { version: 1, sourceRevision: 1 },
        },
        { session },
      );
      if (!changed.modifiedCount)
        throw new ApiError(409, 'VERSION_CONFLICT', 'Appointment changed.');
      const response = responseForChange({
        ...appointment,
        state: 'CANCELLED',
        version: nextVersion,
        refundStatus,
        cancellationId,
      });
      await Outbox.create(
        [
          {
            message_id: createId(),
            message_kind: 'EVENT',
            message_type: 'AppointmentChanged',
            schema_version: 1,
            producer: 'appointment',
            aggregate_id: appointmentId,
            aggregate_version: nextVersion,
            correlation_id: correlationId,
            occurred_at: now,
            payload: {
              sourceType: 'APPOINTMENT',
              sourceId: appointmentId,
              appointmentId,
              patientId: appointment.patientId,
              recipientUserId: appointment.principalId,
              sourceRevision: appointment.sourceRevision + 1,
              cancelledSourceRevision: appointment.sourceRevision,
              state: 'CANCELLED',
              changeType: 'CANCELLED',
              version: nextVersion,
              reasonCode,
              cancellationId,
              refundStatus,
            },
          },
        ],
        { session },
      );
      await Idempotency.create(
        [
          {
            principal_id: principalId,
            route,
            key: idempotencyKey,
            request_hash: hash,
            response,
            created_at: now,
          },
        ],
        { session },
      );
      return response;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const replayAfterRace = await existingIdempotency(
        Idempotency,
        principalId,
        route,
        idempotencyKey,
        hash,
      );
      if (replayAfterRace) return replayAfterRace;
    }
    throw error;
  }
}

module.exports = {
  createAppointment,
  getAppointment,
  listPatientAppointments,
  rescheduleAppointment,
  cancelAppointment,
};

// Cache invalidation runs after successful transaction commit.
module.exports.createAppointment = async (...args) => {
  const result = await createAppointment(...args);
  await require('../services/slot-cache.service').getSlotCache().invalidate();
  return result;
};
module.exports.rescheduleAppointment = async (...args) => {
  const result = await rescheduleAppointment(...args);
  await require('../services/slot-cache.service').getSlotCache().invalidate();
  return result;
};
module.exports.cancelAppointment = async (...args) => {
  const result = await cancelAppointment(...args);
  await require('../services/slot-cache.service').getSlotCache().invalidate();
  return result;
};
