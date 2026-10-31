const { createHash, randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const { getScheduleModel, getSlotModel, getHoldModel, getAppointmentModel, getPatientTimeLockModel, getIdempotencyModel } = require('../models/appointment.model.js');
const { ApiError } = require('../core/errors.js');

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function requestHash(value) { return createHash('sha256').update(stableJson(value)).digest('hex'); }
function assertUuid(value, field) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')) throw new ApiError(400, 'VALIDATION_ERROR', field + ' must be a UUID.');
}
function responseForHold(hold) { return { holdId: hold.id, expiresAt: hold.expiresAt, state: hold.status, slotId: hold.slotId, priceSnapshot: hold.priceSnapshot || null }; }

async function existingIdempotency({ Idempotency, principalId, route, key, hash }) {
  const row = await Idempotency.findOne({ principal_id: principalId, route, key }).lean();
  if (!row) return null;
  if (row.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã được dùng với payload khác.');
  return row.response;
}

async function createHold({ connection, patientId, slotId, principalId, idempotencyKey, now = new Date(), createId = randomUUID, resolvePriceSnapshot = async () => null }) {
  assertUuid(patientId, 'patientId');
  if (!slotId || typeof slotId !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'slotId is required.');
  if (!principalId || !idempotencyKey) throw new ApiError(400, 'VALIDATION_ERROR', 'principalId and Idempotency-Key are required.');
  const route = 'POST /api/v1/appointment-holds';
  const hash = requestHash({ patientId, slotId });
  const Schedule = getScheduleModel(connection); const Slot = getSlotModel(connection); const Hold = getHoldModel(connection); const Appointment = getAppointmentModel(connection); const Lock = getPatientTimeLockModel(connection); const Idempotency = getIdempotencyModel(connection);
  const replay = await existingIdempotency({ Idempotency, principalId, route, key: idempotencyKey, hash });
  if (replay) return replay;
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  try {
    return await withMongoTransaction(connection, async (session) => {
      const slot = await Slot.findOne({ id: slotId }).session(session).lean();
      if (!slot) throw new ApiError(404, 'SLOT_NOT_FOUND', 'Slot không tồn tại.');
      const schedule = await Schedule.findOne({ id: slot.scheduleId, status: 'OPEN' }).session(session).lean();
      if (!schedule) throw new ApiError(409, 'SCHEDULE_UNAVAILABLE', 'Lịch khám không còn mở.');
      await Lock.updateOne({ patientId }, { $set: { updatedAt: now }, $inc: { version: 1 } }, { upsert: true, session });
      const activeHold = await Hold.findOne({ patientId, status: 'HELD', expiresAt: { $gt: now }, slotStartAt: { $lt: slot.endAt }, slotEndAt: { $gt: slot.startAt } }).session(session).lean();
      const activeAppointment = await Appointment.findOne({ patientId, state: { $in: ['PENDING_PAYMENT', 'SETTLEMENT_LOCKED', 'CONFIRMED'] }, startAt: { $lt: slot.endAt }, endAt: { $gt: slot.startAt } }).session(session).lean();
      if (activeHold || activeAppointment) throw new ApiError(409, 'PATIENT_TIME_CONFLICT', 'Bệnh nhân đã có lịch hoặc giữ chỗ trùng giờ.');
      const reserved = await Slot.updateOne({ id: slotId, $expr: { $lt: [{ $add: ['$heldCount', '$confirmedCount'] }, '$capacity'] } }, { $inc: { heldCount: 1 } }, { session });
      if (!reserved.modifiedCount) throw new ApiError(409, 'SLOT_UNAVAILABLE', 'Slot đã hết chỗ.');
      const priceSnapshot = await resolvePriceSnapshot({ slot, schedule, now, session });
      if (!priceSnapshot || priceSnapshot.amountVnd == null || !Number.isInteger(Number(priceSnapshot.amountVnd)) || Number(priceSnapshot.amountVnd) < 0 || !priceSnapshot.snapshotHash) throw new ApiError(503, 'PRICE_PROJECTION_STALE', 'ChÆ°a cÃ³ giÃ¡ Ä‘Ã£ xÃ¡c nháº­n Ä‘á»ƒ giá»¯ chá»—.');
      const hold = { id: createId(), principalId, idempotencyKey, patientId, slotId, scheduleId: slot.scheduleId, doctorId: schedule.doctorId, serviceId: schedule.serviceId, slotStartAt: slot.startAt, slotEndAt: slot.endAt, status: 'HELD', expiresAt, createdAt: now, version: 1, priceSnapshot };
      await Hold.create([hold], { session });
      const response = responseForHold(hold);
      await Idempotency.create([{ principal_id: principalId, route, key: idempotencyKey, request_hash: hash, response, created_at: now }], { session });
      return response;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const replayAfterRace = await existingIdempotency({ Idempotency, principalId, route, key: idempotencyKey, hash });
      if (replayAfterRace) return replayAfterRace;
    }
    throw error;
  }
}

async function releaseHold({ connection, holdId, principalId, expectedVersion, idempotencyKey, now = new Date(), createId = randomUUID }) {
  if (!holdId || !principalId || !idempotencyKey) throw new ApiError(400, 'VALIDATION_ERROR', 'holdId, principalId and Idempotency-Key are required.');
  const route = 'DELETE /api/v1/appointment-holds/' + holdId;
  const hash = requestHash({ holdId, expectedVersion: expectedVersion ?? null });
  const Hold = getHoldModel(connection); const Slot = getSlotModel(connection); const Idempotency = getIdempotencyModel(connection);
  const replay = await existingIdempotency({ Idempotency, principalId, route, key: idempotencyKey, hash });
  if (replay) return replay;
  try {
    return await withMongoTransaction(connection, async (session) => {
    const hold = await Hold.findOne({ id: holdId }).session(session).lean();
    if (!hold) throw new ApiError(404, 'HOLD_NOT_FOUND', 'Hold không tồn tại.');
    if (hold.principalId !== principalId) throw new ApiError(403, 'FORBIDDEN', 'Không có quyền trên hold này.');
    if (expectedVersion != null && Number(expectedVersion) !== hold.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Hold đã thay đổi.');
    if (hold.status !== 'HELD') throw new ApiError(409, 'HOLD_ALREADY_CONSUMED', 'Hold không còn hiệu lực.');
    const changed = await Hold.updateOne({ id: holdId, status: 'HELD', version: hold.version }, { $set: { status: 'RELEASED', releasedAt: now }, $inc: { version: 1 } }, { session });
    if (!changed.modifiedCount) throw new ApiError(409, 'VERSION_CONFLICT', 'Hold đã thay đổi.');
    const restored = await Slot.updateOne({ id: hold.slotId, heldCount: { $gt: 0 } }, { $inc: { heldCount: -1 } }, { session });
    if (!restored.modifiedCount) throw new ApiError(500, 'CAPACITY_INVARIANT_BROKEN', 'Không thể trả sức chứa slot.');
    const response = { holdId, state: 'RELEASED' };
    await Idempotency.create([{ principal_id: principalId, route, key: idempotencyKey, request_hash: hash, response, created_at: now }], { session });
      return response;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const replayAfterRace = await existingIdempotency({ Idempotency, principalId, route, key: idempotencyKey, hash });
      if (replayAfterRace) return replayAfterRace;
    }
    throw error;
  }
}

async function expireHolds({ connection, now = new Date(), batchSize = 100 }) {
  const Hold = getHoldModel(connection); const Slot = getSlotModel(connection);
  let count = 0;
  const candidates = await Hold.find({ status: 'HELD', expiresAt: { $lte: now } }).sort({ expiresAt: 1 }).limit(batchSize).lean();
  for (const candidate of candidates) {
    try {
      await withMongoTransaction(connection, async (session) => {
        const changed = await Hold.updateOne({ id: candidate.id, status: 'HELD', version: candidate.version }, { $set: { status: 'EXPIRED', releasedAt: now }, $inc: { version: 1 } }, { session });
        if (!changed.modifiedCount) return;
        const restored = await Slot.updateOne({ id: candidate.slotId, heldCount: { $gt: 0 } }, { $inc: { heldCount: -1 } }, { session });
        if (!restored.modifiedCount) throw new ApiError(500, 'CAPACITY_INVARIANT_BROKEN', 'Không thể trả sức chứa slot.');
        count += 1;
      });
    } catch (error) { if (error.code !== 11000) throw error; }
  }
  return count;
}

module.exports = { createHold, releaseHold, expireHolds, requestHash, stableJson };
