const { randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const {
  getAppointmentModel,
  getQueueTicketModel,
  getIdempotencyModel,
} = require('../models/appointment.model.js');
const { ApiError } = require('../core/errors.js');
const { requestHash } = require('./holds.service.js');
const {
  enqueueClinicalTicket,
  clinicalTicketSnapshot,
} = require('./clinical-ticket-feed.js');

function vietnamDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(date.getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function assertDate(value, field = 'date') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || ''))
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be YYYY-MM-DD.`);
  const start = new Date(`${value}T00:00:00+07:00`);
  if (!Number.isFinite(start.getTime()) || vietnamDate(start) !== value)
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${field} must be a valid Vietnam date.`,
    );
  return value;
}

function assertTicketType(ticketType) {
  if (ticketType != null && !['FIRST', 'RETURN'].includes(ticketType))
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'ticketType must be FIRST or RETURN.',
    );
}

function assertDoctorScope({ actorType, scopes = [], doctorId }) {
  if (actorType !== 'DOCTOR') return;
  if (
    !doctorId ||
    !(scopes.includes(`doctor:${doctorId}`) || scopes.includes(doctorId))
  )
    throw new ApiError(
      403,
      'FORBIDDEN',
      'A trusted doctor-to-user mapping is required.',
    );
}

function assertVersion(value, field = 'expectedVersion') {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1)
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${field} must be a positive integer.`,
    );
  return version;
}

function responseForTicket(ticket) {
  return {
    ticketId: ticket.id,
    appointmentId: ticket.appointmentId,
    patientId: ticket.patientId,
    doctorId: ticket.doctorId,
    ticketType: ticket.ticketType,
    returnRound: ticket.returnRound,
    state: ticket.state,
    version: ticket.version,
    calledAt: ticket.calledAt || null,
    noShowReason: ticket.noShowReason || null,
  };
}

async function getReplay(Idempotency, principalId, route, key, hash) {
  if (!key) return null;
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
      'Idempotency-Key was reused with another body.',
    );
  return row.response;
}

async function saveReplay(
  Idempotency,
  { principalId, route, key, hash, response, now },
  session,
) {
  if (!key) return;
  await Idempotency.create(
    [
      {
        principal_id: principalId,
        route,
        key,
        request_hash: hash,
        response,
        created_at: now,
      },
    ],
    { session },
  );
}

async function checkInAppointment({
  connection,
  appointmentId,
  staffId,
  expectedVersion,
  idempotencyKey,
  now = new Date(),
  createId = randomUUID,
}) {
  if (!appointmentId || !staffId || !idempotencyKey)
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'appointmentId and Idempotency-Key are required.',
    );
  const route = `POST /api/v1/appointments/${appointmentId}/check-in`;
  const hash = requestHash({ appointmentId });
  const Appointment = getAppointmentModel(connection);
  const QueueTicket = getQueueTicketModel(connection);
  const Idempotency = getIdempotencyModel(connection);
  const replay = await getReplay(
    Idempotency,
    staffId,
    route,
    idempotencyKey,
    hash,
  );
  if (replay) return replay;

  try {
    return await withMongoTransaction(connection, async (session) => {
      const appointment = await Appointment.findOne({ id: appointmentId })
        .session(session)
        .lean();
      if (!appointment)
        throw new ApiError(404, 'NOT_FOUND', 'Appointment not found.');
      if (
        expectedVersion != null &&
        assertVersion(expectedVersion) !== appointment.version
      )
        throw new ApiError(409, 'VERSION_CONFLICT', 'Appointment changed.');
      if (vietnamDate(appointment.startAt) !== vietnamDate(now))
        throw new ApiError(
          409,
          'CHECKIN_DATE_MISMATCH',
          'Check-in is allowed only on the appointment date.',
        );
      if (
        !clinicalTicketSnapshot({
          ...appointment,
          appointmentId: appointment.id,
          ticketType: 'FIRST',
          state: 'WAITING',
          version: 1,
        })
      )
        throw new ApiError(
          409,
          'CLINICAL_MAPPING_UNAVAILABLE',
          'Trusted doctor and department mapping is required before check-in.',
        );
      if (appointment.state === 'CHECKED_IN') {
        const existing = await QueueTicket.findOne({
          appointmentId,
          ticketType: 'FIRST',
          returnRound: 0,
        })
          .session(session)
          .lean();
        if (!existing)
          throw new ApiError(
            409,
            'QUEUE_STATE_INCONSISTENT',
            'FIRST ticket is missing.',
          );
        const response = responseForTicket(existing);
        await saveReplay(
          Idempotency,
          {
            principalId: staffId,
            route,
            key: idempotencyKey,
            hash,
            response,
            now,
          },
          session,
        );
        return response;
      }
      if (
        appointment.state !== 'CONFIRMED' ||
        appointment.chargeStatus !== 'PAID'
      )
        throw new ApiError(
          409,
          'APPOINTMENT_NOT_PAYABLE',
          'Appointment is not confirmed and paid.',
        );
      const changed = await Appointment.updateOne(
        { id: appointmentId, state: 'CONFIRMED', version: appointment.version },
        {
          $set: {
            state: 'CHECKED_IN',
            checkedInAt: now,
            checkedInBy: staffId,
            updatedAt: now,
          },
          $push: {
            stateHistory: { state: 'CHECKED_IN', at: now, by: staffId },
          },
          $inc: { version: 1 },
        },
        { session },
      );
      if (!changed.modifiedCount)
        throw new ApiError(409, 'VERSION_CONFLICT', 'Appointment changed.');

      const ticket = {
        id: createId(),
        appointmentId,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        doctorUserId: appointment.doctorUserId,
        departmentId: appointment.departmentId,
        ticketType: 'FIRST',
        returnRound: 0,
        state: 'WAITING',
        stateHistory: [{ state: 'WAITING', at: now, by: staffId }],
        version: 1,
        createdAt: now,
        updatedAt: now,
        appointmentDate: vietnamDate(appointment.startAt),
      };
      await QueueTicket.create([ticket], { session });
      await enqueueClinicalTicket(connection, session, ticket, now);
      const response = responseForTicket(ticket);
      response.appointmentId = appointmentId;
      response.ticket = { ...response };
      await saveReplay(
        Idempotency,
        {
          principalId: staffId,
          route,
          key: idempotencyKey,
          hash,
          response,
          now,
        },
        session,
      );
      return response;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const replayAfterRace = await getReplay(
        Idempotency,
        staffId,
        route,
        idempotencyKey,
        hash,
      );
      if (replayAfterRace) return replayAfterRace;
    }
    throw error;
  }
}

async function listTodayQueue({
  connection,
  actorType,
  capabilities = [],
  scopes = [],
  doctorId,
  ticketType,
  date,
  page = 1,
  limit = 20,
  now = new Date(),
}) {
  if (actorType === 'STAFF' && !capabilities.includes('RECEPTION'))
    throw new ApiError(403, 'FORBIDDEN', 'RECEPTION capability is required.');
  if (!['STAFF', 'DOCTOR'].includes(actorType))
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Queue is restricted to staff and doctors.',
    );
  assertTicketType(ticketType);
  assertDoctorScope({ actorType, scopes, doctorId });
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
  const queueDate = assertDate(date || vietnamDate(now));
  const query = {
    appointmentDate: queueDate,
    state: { $in: ['WAITING', 'CALLED', 'CLAIMED'] },
  };
  if (ticketType) query.ticketType = ticketType;
  if (doctorId) query.doctorId = doctorId;
  const QueueTicket = getQueueTicketModel(connection);
  const [items, total] = await Promise.all([
    QueueTicket.find(query)
      .sort({ createdAt: 1, id: 1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .lean(),
    QueueTicket.countDocuments(query),
  ]);
  return {
    items: items.map(responseForTicket),
    total,
    page: parsedPage,
    limit: parsedLimit,
    date: queueDate,
  };
}

async function callNextQueueTicket({
  connection,
  actorType,
  capabilities = [],
  scopes = [],
  doctorId,
  ticketType = 'FIRST',
  calledBy,
  idempotencyKey,
  now = new Date(),
}) {
  if (actorType === 'STAFF' && !capabilities.includes('RECEPTION'))
    throw new ApiError(403, 'FORBIDDEN', 'RECEPTION capability is required.');
  if (!['STAFF', 'DOCTOR'].includes(actorType))
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Queue is restricted to staff and doctors.',
    );
  assertTicketType(ticketType);
  assertDoctorScope({ actorType, scopes, doctorId });
  if (!calledBy || !idempotencyKey)
    throw new ApiError(400, 'VALIDATION_ERROR', 'Idempotency-Key is required.');
  const route = 'POST /api/v1/queues/call-next';
  const hash = requestHash({ ticketType, doctorId: doctorId || null });
  const Idempotency = getIdempotencyModel(connection);
  const replay = await getReplay(
    Idempotency,
    calledBy,
    route,
    idempotencyKey,
    hash,
  );
  if (replay) return replay;
  const QueueTicket = getQueueTicketModel(connection);
  const query = {
    appointmentDate: vietnamDate(now),
    ticketType,
    state: 'WAITING',
  };
  if (doctorId) query.doctorId = doctorId;
  return withMongoTransaction(connection, async (session) => {
    const replayInTransaction = await getReplay(
      Idempotency,
      calledBy,
      route,
      idempotencyKey,
      hash,
    );
    if (replayInTransaction) return replayInTransaction;
    const ticket = await QueueTicket.findOneAndUpdate(
      query,
      {
        $set: { state: 'CALLED', calledAt: now, calledBy, updatedAt: now },
        $push: { stateHistory: { state: 'CALLED', at: now, by: calledBy } },
        $inc: { version: 1 },
      },
      { sort: { createdAt: 1, id: 1 }, returnDocument: 'after', session },
    ).lean();
    if (!ticket)
      throw new ApiError(
        409,
        'QUEUE_EMPTY',
        'No waiting ticket matches the requested queue.',
      );
    await enqueueClinicalTicket(connection, session, ticket, now);
    const response = responseForTicket(ticket);
    response.ticket = { ...response };
    await saveReplay(
      Idempotency,
      {
        principalId: calledBy,
        route,
        key: idempotencyKey,
        hash,
        response,
        now,
      },
      session,
    );
    return response;
  });
}

async function markNoShow({
  connection,
  ticketId,
  staffId,
  reasonCode,
  expectedVersion,
  idempotencyKey,
  now = new Date(),
}) {
  if (!ticketId || !staffId || !reasonCode || !idempotencyKey)
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'ticketId, reasonCode and Idempotency-Key are required.',
    );
  const version = assertVersion(expectedVersion);
  const route = `POST /api/v1/queues/${ticketId}/no-show`;
  const hash = requestHash({ ticketId, reasonCode, expectedVersion: version });
  const QueueTicket = getQueueTicketModel(connection);
  const Appointment = getAppointmentModel(connection);
  const Idempotency = getIdempotencyModel(connection);
  const replay = await getReplay(
    Idempotency,
    staffId,
    route,
    idempotencyKey,
    hash,
  );
  if (replay) return replay;
  try {
    return await withMongoTransaction(connection, async (session) => {
      const ticket = await QueueTicket.findOne({ id: ticketId })
        .session(session)
        .lean();
      if (!ticket)
        throw new ApiError(404, 'NOT_FOUND', 'Queue ticket not found.');
      if (ticket.state === 'NO_SHOW') {
        const response = responseForTicket(ticket);
        await saveReplay(
          Idempotency,
          {
            principalId: staffId,
            route,
            key: idempotencyKey,
            hash,
            response,
            now,
          },
          session,
        );
        return response;
      }
      if (!['WAITING', 'CALLED'].includes(ticket.state))
        throw new ApiError(
          409,
          'QUEUE_STATE_CONFLICT',
          'Only waiting or called tickets can be marked no-show.',
        );
      if (ticket.version !== version)
        throw new ApiError(409, 'VERSION_CONFLICT', 'Queue ticket changed.');
      const changed = await QueueTicket.updateOne(
        { id: ticketId, state: { $in: ['WAITING', 'CALLED'] }, version },
        {
          $set: {
            state: 'NO_SHOW',
            noShowReason: reasonCode,
            noShowAt: now,
            updatedAt: now,
          },
          $push: {
            stateHistory: {
              state: 'NO_SHOW',
              at: now,
              by: staffId,
              reasonCode,
            },
          },
          $inc: { version: 1 },
        },
        { session },
      );
      if (!changed.modifiedCount)
        throw new ApiError(409, 'VERSION_CONFLICT', 'Queue ticket changed.');
      if (ticket.ticketType === 'FIRST') {
        await Appointment.updateOne(
          {
            id: ticket.appointmentId,
            state: { $in: ['CHECKED_IN', 'CONFIRMED'] },
          },
          {
            $set: {
              state: 'NO_SHOW',
              noShowReason: reasonCode,
              updatedAt: now,
            },
            $push: {
              stateHistory: {
                state: 'NO_SHOW',
                at: now,
                by: staffId,
                reasonCode,
              },
            },
            $inc: { version: 1 },
          },
          { session },
        );
      }
      const updated = {
        ...ticket,
        state: 'NO_SHOW',
        noShowReason: reasonCode,
        version: version + 1,
      };
      await enqueueClinicalTicket(connection, session, updated, now);
      const response = responseForTicket(updated);
      await saveReplay(
        Idempotency,
        {
          principalId: staffId,
          route,
          key: idempotencyKey,
          hash,
          response,
          now,
        },
        session,
      );
      return response;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const replayAfterRace = await getReplay(
        Idempotency,
        staffId,
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
  vietnamDate,
  checkInAppointment,
  listTodayQueue,
  callNextQueueTicket,
  markNoShow,
  responseForTicket,
};
