const { randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const { getScheduleModel, getSlotModel } = require('../models/appointment.model.js');
const { ApiError } = require('../core/errors.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertAdmin({ actorType, capabilities }) {
  if (actorType !== 'STAFF' || !capabilities.includes('ADMIN'))
    throw new ApiError(403, 'FORBIDDEN', 'ADMIN capability is required.');
}

function parseSchedule(body, { partial = false } = {}) {
  const value = body || {};
  const required = ['doctorId', 'serviceId', 'startAt', 'endAt', 'capacityPerSlot', 'slotMinutes'];
  if (!partial && required.some((field) => value[field] == null))
    throw new ApiError(400, 'VALIDATION_ERROR', 'doctorId, serviceId, startAt, endAt, capacityPerSlot and slotMinutes are required.');
  if (value.doctorId != null && !UUID.test(value.doctorId)) throw new ApiError(400, 'VALIDATION_ERROR', 'doctorId must be a UUID.');
  if (value.serviceId != null && !UUID.test(value.serviceId)) throw new ApiError(400, 'VALIDATION_ERROR', 'serviceId must be a UUID.');
  if (value.doctorUserId != null && !UUID.test(value.doctorUserId)) throw new ApiError(400, 'VALIDATION_ERROR', 'doctorUserId must be a UUID.');
  if (value.departmentId != null && !UUID.test(value.departmentId)) throw new ApiError(400, 'VALIDATION_ERROR', 'departmentId must be a UUID.');
  const startAt = value.startAt == null ? undefined : new Date(value.startAt);
  const endAt = value.endAt == null ? undefined : new Date(value.endAt);
  if (startAt && !Number.isFinite(startAt.getTime())) throw new ApiError(400, 'VALIDATION_ERROR', 'startAt is invalid.');
  if (endAt && !Number.isFinite(endAt.getTime())) throw new ApiError(400, 'VALIDATION_ERROR', 'endAt is invalid.');
  if (startAt && endAt && endAt <= startAt) throw new ApiError(400, 'VALIDATION_ERROR', 'endAt must be after startAt.');
  if (value.capacityPerSlot != null && (!Number.isInteger(Number(value.capacityPerSlot)) || Number(value.capacityPerSlot) < 1))
    throw new ApiError(400, 'VALIDATION_ERROR', 'capacityPerSlot must be a positive integer.');
  if (value.slotMinutes != null && (!Number.isInteger(Number(value.slotMinutes)) || Number(value.slotMinutes) < 5))
    throw new ApiError(400, 'VALIDATION_ERROR', 'slotMinutes must be at least 5 minutes.');
  if (value.status != null && !['OPEN', 'CLOSED'].includes(value.status)) throw new ApiError(400, 'VALIDATION_ERROR', 'status must be OPEN or CLOSED.');
  return {
    ...(value.doctorId != null ? { doctorId: value.doctorId } : {}),
    ...(value.serviceId != null ? { serviceId: value.serviceId } : {}),
    ...(value.doctorUserId != null ? { doctorUserId: value.doctorUserId } : {}),
    ...(value.departmentId != null ? { departmentId: value.departmentId } : {}),
    ...(value.room != null ? { room: String(value.room).trim() } : {}),
    ...(startAt ? { startAt } : {}),
    ...(endAt ? { endAt } : {}),
    ...(value.capacityPerSlot != null ? { capacityPerSlot: Number(value.capacityPerSlot) } : {}),
    ...(value.slotMinutes != null ? { slotMinutes: Number(value.slotMinutes) } : {}),
    ...(value.status != null ? { status: value.status } : {}),
  };
}

async function assertNoOverlap(Schedule, data, scheduleId, session) {
  const overlap = await Schedule.findOne({
    id: { $ne: scheduleId },
    status: 'OPEN',
    doctorId: data.doctorId,
    startAt: { $lt: data.endAt },
    endAt: { $gt: data.startAt },
  }).session(session).lean();
  if (overlap) throw new ApiError(409, 'SCHEDULE_OVERLAP', 'Doctor already has an overlapping schedule.');
}

async function createSchedule({ connection, authContext, body, createId = randomUUID, now = new Date() }) {
  assertAdmin(authContext);
  const data = parseSchedule(body);
  if (data.startAt <= now) throw new ApiError(400, 'VALIDATION_ERROR', 'Schedule must be in the future.');
  const Schedule = getScheduleModel(connection);
  const Slot = getSlotModel(connection);
  return withMongoTransaction(connection, async (session) => {
    await assertNoOverlap(Schedule, data, null, session);
    const schedule = { id: createId(), ...data, status: data.status || 'OPEN', version: 1 };
    await Schedule.create([schedule], { session });
    const slotCount = Math.ceil((schedule.endAt.getTime() - schedule.startAt.getTime()) / (schedule.slotMinutes * 60 * 1000));
    const slots = Array.from({ length: slotCount }, (_, index) => {
      const startAt = new Date(schedule.startAt.getTime() + index * schedule.slotMinutes * 60 * 1000);
      const endAt = new Date(Math.min(startAt.getTime() + schedule.slotMinutes * 60 * 1000, schedule.endAt.getTime()));
      return { id: createId(), scheduleId: schedule.id, startAt, endAt, capacity: schedule.capacityPerSlot, heldCount: 0, confirmedCount: 0 };
    });
    if (slots.length) await Slot.insertMany(slots, { session });
    return { schedule, slots };
  });
}

async function updateSchedule({ connection, authContext, scheduleId, body, now = new Date() }) {
  assertAdmin(authContext);
  if (!scheduleId) throw new ApiError(400, 'VALIDATION_ERROR', 'scheduleId is required.');
  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new ApiError(400, 'VALIDATION_ERROR', 'expectedVersion must be a positive integer.');
  const Schedule = getScheduleModel(connection);
  const Slot = getSlotModel(connection);
  return withMongoTransaction(connection, async (session) => {
    const current = await Schedule.findOne({ id: scheduleId }).session(session).lean();
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Schedule not found.');
    if (current.version !== expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', 'Schedule changed.');
    if (current.startAt <= now) throw new ApiError(409, 'SCHEDULE_IMMUTABLE', 'Past schedule cannot be changed.');
    const data = parseSchedule(body, { partial: true });
    const next = { ...current, ...data };
    await assertNoOverlap(Schedule, next, scheduleId, session);
    const occupied = await Slot.aggregate([
      { $match: { scheduleId } },
      { $group: { _id: null, held: { $sum: '$heldCount' }, confirmed: { $sum: '$confirmedCount' } } },
    ]).session(session);
    const occupiedCount = (occupied[0]?.held || 0) + (occupied[0]?.confirmed || 0);
    if (data.capacityPerSlot != null && data.capacityPerSlot < occupiedCount)
      throw new ApiError(409, 'CAPACITY_BELOW_OCCUPIED', 'capacityPerSlot cannot be below occupied slots.');
    const changed = await Schedule.updateOne({ id: scheduleId, version: expectedVersion }, { $set: { ...data }, $inc: { version: 1 } }, { session });
    if (!changed.modifiedCount) throw new ApiError(409, 'VERSION_CONFLICT', 'Schedule changed.');
    return { ...next, version: expectedVersion + 1 };
  });
}

async function listSchedules({ connection, authContext, from, to, page = 1, limit = 50 }) {
  assertAdmin(authContext);
  const parsedPage = Number(page); const parsedLimit = Number(limit);
  if (!Number.isInteger(parsedPage) || parsedPage < 1 || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)
    throw new ApiError(400, 'VALIDATION_ERROR', 'page/limit is invalid.');
  const query = {};
  if (from || to) query.startAt = { ...(from ? { $gte: new Date(`${from}T00:00:00+07:00`) } : {}), ...(to ? { $lt: new Date(`${to}T00:00:00+07:00`) } : {}) };
  const Schedule = getScheduleModel(connection);
  const [items, total] = await Promise.all([
    Schedule.find(query).sort({ startAt: 1 }).skip((parsedPage - 1) * parsedLimit).limit(parsedLimit).lean(),
    Schedule.countDocuments(query),
  ]);
  return { items, total, page: parsedPage, limit: parsedLimit };
}

module.exports = { createSchedule, updateSchedule, listSchedules, parseSchedule };
