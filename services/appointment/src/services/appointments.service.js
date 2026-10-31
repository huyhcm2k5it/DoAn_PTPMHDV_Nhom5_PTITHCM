const { createHash, randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const {
  getHoldModel,
  getSlotModel,
  getAppointmentModel,
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
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')
  )
    throw new ApiError(400, 'VALIDATION_ERROR', field + ' must be a UUID.');
}
async function existingIdempotency(Idempotency, principalId, route, key, hash) {
  const row = await Idempotency.findOne({ principal_id: principalId, route, key }).lean();
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
  const replay = await existingIdempotency(Idempotency, principalId, route, idempotencyKey, hash);
  if (replay) return replay;
  try {
    return await withMongoTransaction(connection, async (session) => {
      const hold = await Hold.findOne({ id: holdId }).session(session).lean();
      if (!hold) throw new ApiError(404, 'HOLD_NOT_FOUND', 'Hold không tồn tại.');
      if (hold.principalId !== principalId || hold.patientId !== patientId)
        throw new ApiError(403, 'FORBIDDEN', 'Không có quyền trên hold này.');
      if (hold.status !== 'HELD')
        throw new ApiError(
          409,
          hold.status === 'EXPIRED' ? 'HOLD_EXPIRED' : 'HOLD_ALREADY_CONSUMED',
          'Hold không còn hiệu lực.',
        );
      if (hold.expiresAt <= now) throw new ApiError(409, 'HOLD_EXPIRED', 'Hold đã hết hạn.');
      if (
        !hold.priceSnapshot ||
        hold.priceSnapshot.amountVnd == null ||
        !hold.priceSnapshot.snapshotHash
      )
        throw new ApiError(503, 'PRICE_PROJECTION_STALE', 'Chưa có giá đã xác nhận để tạo lịch.');
      const appointmentId = createId();
      const requestId = createId();
      const changed = await Hold.updateOne(
        { id: holdId, status: 'HELD', version: hold.version, expiresAt: { $gt: now } },
        { $set: { status: 'CONSUMED' }, $inc: { version: 1 } },
        { session },
      );
      if (!changed.modifiedCount)
        throw new ApiError(409, 'HOLD_EXPIRED', 'Hold đã hết hạn hoặc đã được tiêu thụ.');
      const slot = await Slot.findOne({ id: hold.slotId }).session(session).lean();
      if (!slot) throw new ApiError(404, 'SLOT_NOT_FOUND', 'Slot không tồn tại.');
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
        serviceId: hold.serviceId,
        startAt: hold.slotStartAt,
        endAt: hold.slotEndAt,
        state: 'PENDING_PAYMENT',
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
            producer: 'Appointment',
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
  if (!appointment) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy lịch hẹn.');
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

module.exports = { createAppointment, getAppointment, listPatientAppointments };
