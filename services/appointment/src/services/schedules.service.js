const { randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const {
  getScheduleModel,
  getSlotModel,
  getHoldModel,
  getAppointmentModel,
  getIdempotencyModel,
} = require('../models/appointment.model.js');
const { ApiError } = require('../core/errors.js');
const { requestHash } = require('./holds.service.js');
const { getSlotCache } = require('./slot-cache.service.js');

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertAdmin({ actorType, capabilities }) {
  if (actorType !== 'STAFF' || !capabilities.includes('ADMIN'))
    throw new ApiError(403, 'FORBIDDEN', 'ADMIN capability is required.');
}

function parseSchedule(body, { partial = false } = {}) {
  const value = body || {};
  const required = [
    'doctorId',
    'serviceId',
    'room',
    'startAt',
    'endAt',
    'capacityPerSlot',
    'slotMinutes',
  ];
  if (!partial && required.some((field) => value[field] == null))
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'doctorId, serviceId, room, startAt, endAt, capacityPerSlot and slotMinutes are required.',
    );
  if (value.doctorId != null && !UUID.test(value.doctorId))
    throw new ApiError(400, 'VALIDATION_ERROR', 'doctorId must be a UUID.');
  if (value.serviceId != null && !UUID.test(value.serviceId))
    throw new ApiError(400, 'VALIDATION_ERROR', 'serviceId must be a UUID.');
  if (value.doctorUserId != null && !UUID.test(value.doctorUserId))
    throw new ApiError(400, 'VALIDATION_ERROR', 'doctorUserId must be a UUID.');
  if (value.departmentId != null && !UUID.test(value.departmentId))
    throw new ApiError(400, 'VALIDATION_ERROR', 'departmentId must be a UUID.');
  if (
    Object.hasOwn(value, 'room') &&
    (typeof value.room !== 'string' || !value.room.trim())
  )
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'room must be a nonempty string.',
    );
  const startAt = value.startAt == null ? undefined : new Date(value.startAt);
  const endAt = value.endAt == null ? undefined : new Date(value.endAt);
  if (startAt && !Number.isFinite(startAt.getTime()))
    throw new ApiError(400, 'VALIDATION_ERROR', 'startAt is invalid.');
  if (endAt && !Number.isFinite(endAt.getTime()))
    throw new ApiError(400, 'VALIDATION_ERROR', 'endAt is invalid.');
  if (startAt && endAt && endAt <= startAt)
    throw new ApiError(400, 'VALIDATION_ERROR', 'endAt must be after startAt.');
  if (
    value.capacityPerSlot != null &&
    (!Number.isInteger(Number(value.capacityPerSlot)) ||
      Number(value.capacityPerSlot) < 1)
  )
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'capacityPerSlot must be a positive integer.',
    );
  if (
    value.slotMinutes != null &&
    (!Number.isInteger(Number(value.slotMinutes)) ||
      Number(value.slotMinutes) < 5)
  )
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'slotMinutes must be at least 5 minutes.',
    );
  if (value.status != null && !['OPEN', 'CLOSED'].includes(value.status))
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'status must be OPEN or CLOSED.',
    );
  return {
    ...(value.doctorId != null ? { doctorId: value.doctorId } : {}),
    ...(value.serviceId != null ? { serviceId: value.serviceId } : {}),
    ...(value.doctorUserId != null ? { doctorUserId: value.doctorUserId } : {}),
    ...(value.departmentId != null ? { departmentId: value.departmentId } : {}),
    ...(value.room != null ? { room: String(value.room).trim() } : {}),
    ...(startAt ? { startAt } : {}),
    ...(endAt ? { endAt } : {}),
    ...(value.capacityPerSlot != null
      ? { capacityPerSlot: Number(value.capacityPerSlot) }
      : {}),
    ...(value.slotMinutes != null
      ? { slotMinutes: Number(value.slotMinutes) }
      : {}),
    ...(value.status != null ? { status: value.status } : {}),
  };
}

function validateWindow(schedule, now) {
  if (schedule.startAt <= now)
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Schedule must be in the future.',
    );
  if (!(schedule.endAt > schedule.startAt))
    throw new ApiError(400, 'VALIDATION_ERROR', 'endAt must be after startAt.');
}

function slotWindows(schedule) {
  const start = schedule.startAt.getTime();
  const end = schedule.endAt.getTime();
  const step = schedule.slotMinutes * 60_000;
  const count = Math.ceil((end - start) / step);
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000)
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid number of slots.');
  return Array.from({ length: count }, (_, index) => {
    const startAt = start + index * step;
    return {
      startAt: new Date(startAt),
      endAt: new Date(Math.min(startAt + step, end)),
    };
  });
}

function newSlot(schedule, window, createId) {
  return {
    id: createId(),
    scheduleId: schedule.id,
    ...window,
    capacity: schedule.capacityPerSlot,
    heldCount: 0,
    confirmedCount: 0,
    version: 1,
  };
}

async function withScheduleWrite(connection, work) {
  // A shared write serializes overlap checks across different schedule documents.
  // Initialize outside the transaction so retries always have a row to lock.
  const locks = connection.collection('schedule_write_locks');
  const identity = { _id: 'schedules' };
  try {
    await locks.updateOne(
      identity,
      { $setOnInsert: { revision: 0 } },
      { upsert: true, writeConcern: { w: 'majority' } },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  return withMongoTransaction(connection, async (session) => {
    await locks.updateOne(identity, { $inc: { revision: 1 } }, { session });
    return work(session);
  });
}

async function mutateSchedule(
  connection,
  authContext,
  key,
  route,
  body,
  now,
  work,
) {
  assertAdmin(authContext);
  if (typeof key !== 'string' || !UUID.test(key))
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Idempotency-Key must be a UUID.',
    );
  const identity = { principal_id: authContext.userId, route, key };
  const hash = requestHash(body || {});
  const Idempotency = getIdempotencyModel(connection);

  const result = await withScheduleWrite(connection, async (session) => {
    const prior = await Idempotency.findOne(identity).session(session).lean();
    if (prior) {
      if (prior.request_hash !== hash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key was already used with a different payload.',
        );
      return { changed: false, response: prior.response };
    }
    const response = await work(session);
    await Idempotency.create(
      [{ ...identity, request_hash: hash, response, created_at: now }],
      { session },
    );
    return { changed: true, response };
  });
  if (result.changed) await getSlotCache().invalidate();
  return result.response;
}

async function assertNoOverlap(Schedule, data, scheduleId, session) {
  if (data.status !== 'OPEN') return;
  const resources = [{ doctorId: data.doctorId }];
  if (data.room) resources.push({ room: data.room });
  const query = Schedule.findOne({
    id: { $ne: scheduleId },
    status: 'OPEN',
    $or: resources,
    startAt: { $lt: data.endAt },
    endAt: { $gt: data.startAt },
  }).session(session);
  if (data.room) query.collation({ locale: 'en', strength: 2 });
  if (await query.lean())
    throw new ApiError(
      409,
      'SCHEDULE_OVERLAP',
      'Doctor or room already has an overlapping schedule.',
    );
}

async function assertSlotsCanChange(connection, ids, session) {
  if (!ids.length) return;
  const references = { $in: ids };
  const hold = await getHoldModel(connection)
    .exists({ slotId: references })
    .session(session);
  const appointment = await getAppointmentModel(connection)
    .exists({
      $or: [
        { slotId: references },
        { 'slotHistory.fromSlotId': references },
        { 'slotHistory.toSlotId': references },
      ],
    })
    .session(session);
  if (hold || appointment)
    throw new ApiError(
      409,
      'BOOKED_CAPACITY_CONFLICT',
      'A slot referenced by booking history cannot be moved or removed.',
    );
}

async function syncScheduleSlots(
  connection,
  Slot,
  current,
  next,
  createId,
  session,
) {
  const gridChanged =
    Number(current.startAt) !== Number(next.startAt) ||
    Number(current.endAt) !== Number(next.endAt) ||
    current.slotMinutes !== next.slotMinutes;
  const bookingFieldsChanged = [
    'doctorId',
    'doctorUserId',
    'departmentId',
    'serviceId',
  ].some((field) => current[field] !== next[field]);
  if (
    !gridChanged &&
    !bookingFieldsChanged &&
    current.capacityPerSlot === next.capacityPerSlot &&
    current.status === next.status
  )
    return;

  const slots = await Slot.find({ scheduleId: next.id })
    .session(session)
    .lean();
  const desired = gridChanged ? slotWindows(next) : slots;
  const starts = new Map(desired.map((item) => [Number(item.startAt), item]));
  const changedSlots = slots.filter((slot) => {
    const window = starts.get(Number(slot.startAt));
    return !window || Number(window.endAt) !== Number(slot.endAt);
  });
  const changedIds = new Set(changedSlots.map((slot) => slot.id));

  for (const slot of slots) {
    const occupied = slot.heldCount + slot.confirmedCount;
    if (occupied > 0 && (bookingFieldsChanged || changedIds.has(slot.id)))
      throw new ApiError(
        409,
        'BOOKED_CAPACITY_CONFLICT',
        'An occupied slot cannot be moved, removed or assigned to a different service or doctor.',
      );
    if (occupied > next.capacityPerSlot)
      throw new ApiError(
        409,
        'BOOKED_CAPACITY_CONFLICT',
        'Capacity cannot be below the number of bookings in a slot.',
      );
  }
  await assertSlotsCanChange(connection, [...changedIds], session);

  for (const slot of slots) {
    const start = Number(slot.startAt);
    const window = starts.get(start);
    const filter = { id: slot.id, scheduleId: next.id };
    if (!window) {
      await Slot.deleteOne(filter, { session });
      continue;
    }
    starts.delete(start);
    // Every retained slot is written so a concurrent hold cannot commit from
    // a snapshot with the old capacity, schedule status or doctor mapping.
    const update = changedIds.has(slot.id)
      ? { $set: newSlot(next, window, createId) }
      : {
          $set: { capacity: next.capacityPerSlot },
          $inc: { version: 1 },
        };
    await Slot.updateOne(filter, update, { session });
  }
  const added = [...starts.values()].map((window) =>
    newSlot(next, window, createId),
  );
  if (added.length) await Slot.insertMany(added, { session });
}

async function createSchedule({
  connection,
  authContext,
  body,
  idempotencyKey,
  createId = randomUUID,
  now = new Date(),
}) {
  const Schedule = getScheduleModel(connection);
  const Slot = getSlotModel(connection);
  return mutateSchedule(
    connection,
    authContext,
    idempotencyKey,
    'POST /api/v1/schedules',
    body,
    now,
    async (session) => {
      const data = parseSchedule(body);
      validateWindow(data, now);
      const schedule = {
        id: createId(),
        ...data,
        status: data.status || 'OPEN',
        version: 1,
      };
      await assertNoOverlap(Schedule, schedule, null, session);
      const slots = slotWindows(schedule).map((window) =>
        newSlot(schedule, window, createId),
      );
      await Schedule.create([schedule], { session });
      await Slot.insertMany(slots, { session });
      return { schedule, slots };
    },
  );
}

async function updateSchedule({
  connection,
  authContext,
  scheduleId,
  body,
  idempotencyKey,
  createId = randomUUID,
  now = new Date(),
}) {
  assertAdmin(authContext);
  if (typeof scheduleId !== 'string' || !UUID.test(scheduleId))
    throw new ApiError(400, 'VALIDATION_ERROR', 'scheduleId must be a UUID.');
  const Schedule = getScheduleModel(connection);
  const Slot = getSlotModel(connection);
  return mutateSchedule(
    connection,
    authContext,
    idempotencyKey,
    'PATCH /api/v1/schedules/' + scheduleId,
    body,
    now,
    async (session) => {
      const expectedVersion = Number(body?.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1)
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'expectedVersion must be a positive integer.',
        );
      const data = parseSchedule(body, { partial: true });
      const current = await Schedule.findOne({ id: scheduleId })
        .session(session)
        .lean();
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'Schedule not found.');
      if (current.version !== expectedVersion)
        throw new ApiError(
          409,
          'SCHEDULE_VERSION_CONFLICT',
          'Schedule changed.',
        );
      if (current.startAt <= now)
        throw new ApiError(
          409,
          'SCHEDULE_IMMUTABLE',
          'Past schedule cannot be changed.',
        );
      const { _id, ...schedule } = current;
      const next = { ...schedule, ...data };
      if (!next.room?.trim())
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'room is required for this schedule.',
        );
      validateWindow(next, now);
      await assertNoOverlap(Schedule, next, scheduleId, session);
      await syncScheduleSlots(
        connection,
        Slot,
        current,
        next,
        createId,
        session,
      );
      const changed = await Schedule.updateOne(
        { id: scheduleId, version: expectedVersion },
        { $set: { ...data }, $inc: { version: 1 } },
        { session },
      );
      if (!changed.modifiedCount)
        throw new ApiError(
          409,
          'SCHEDULE_VERSION_CONFLICT',
          'Schedule changed.',
        );
      return { ...next, version: expectedVersion + 1 };
    },
  );
}

async function listSchedules({
  connection,
  authContext,
  from,
  to,
  page = 1,
  limit = 50,
}) {
  assertAdmin(authContext);
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);
  if (
    !Number.isInteger(parsedPage) ||
    parsedPage < 1 ||
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > 100
  )
    throw new ApiError(400, 'VALIDATION_ERROR', 'page/limit is invalid.');
  const query = {};
  if (from || to)
    query.startAt = {
      ...(from ? { $gte: new Date(`${from}T00:00:00+07:00`) } : {}),
      ...(to ? { $lt: new Date(`${to}T00:00:00+07:00`) } : {}),
    };
  const Schedule = getScheduleModel(connection);
  const [items, total] = await Promise.all([
    Schedule.find(query)
      .sort({ startAt: 1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .lean(),
    Schedule.countDocuments(query),
  ]);
  return { items, total, page: parsedPage, limit: parsedLimit };
}

module.exports = {
  createSchedule,
  updateSchedule,
  listSchedules,
  parseSchedule,
};
