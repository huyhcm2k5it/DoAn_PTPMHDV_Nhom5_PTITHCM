const { createHash, randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const {
  getAppointmentModel,
  getQueueTicketModel,
  getInboxModel,
  getOutboxModel,
} = require('../models/appointment.model.js');
const { ApiError } = require('../core/errors.js');
const {
  enqueueClinicalTicket,
} = require('../services/clinical-ticket-feed.js');

function hashPayload(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function envelopeFor({
  message,
  payload,
  state,
  claimId,
  reasonCode,
  aggregateVersion,
  now,
}) {
  return {
    message_id: randomUUID(),
    message_kind: 'EVENT',
    message_type: 'QueueTicketClaimed',
    schema_version: 1,
    producer: 'appointment',
    aggregate_id: payload.ticketId,
    aggregate_version: aggregateVersion,
    correlation_id: message.correlationId || message.requestId || randomUUID(),
    request_id: payload.requestId || message.requestId || message.messageId,
    causation_id: message.messageId,
    occurred_at: now,
    payload: {
      requestId: payload.requestId || message.requestId || message.messageId,
      ticketId: payload.ticketId,
      appointmentId: payload.appointmentId,
      patientId: payload.patientId,
      ...(payload.visitId ? { visitId: payload.visitId } : {}),
      ...(claimId ? { claimId } : {}),
      state,
      ...(reasonCode ? { reasonCode } : {}),
    },
  };
}

async function handleClaimQueueTicketCommand({
  connection,
  message,
  now = new Date(),
  createId = randomUUID,
  consumerName = 'appointment-claim-queue-ticket',
}) {
  if (
    !message?.messageId ||
    message.messageKind !== 'COMMAND' ||
    message.messageType !== 'ClaimQueueTicket'
  )
    throw new ApiError(
      400,
      'INVALID_MESSAGE',
      'ClaimQueueTicket command is incomplete.',
    );
  const payload = message.payload || {};
  for (const field of ['requestId', 'ticketId', 'doctorId', 'patientId'])
    if (typeof payload[field] !== 'string' || !payload[field].trim())
      throw new ApiError(
        400,
        'INVALID_MESSAGE',
        `ClaimQueueTicket ${field} is required.`,
      );
  if (
    !Number.isInteger(payload.expectedTicketVersion) ||
    payload.expectedTicketVersion < 1
  )
    throw new ApiError(
      400,
      'INVALID_MESSAGE',
      'ClaimQueueTicket expectedTicketVersion is invalid.',
    );
  const hash = hashPayload(payload);
  const commandResults = connection.collection('command_results');
  const existingCommand = await commandResults.findOne({
    command_id: message.messageId,
  });
  if (existingCommand) {
    if (existingCommand.request_hash && existingCommand.request_hash !== hash)
      throw new ApiError(
        409,
        'MESSAGE_CONFLICT',
        'Command id was reused with another payload.',
      );
    await connection
      .collection('outbox')
      .updateOne(
        { message_id: existingCommand.response_message_id },
        { $set: { published_at: null } },
      );
    return existingCommand.response;
  }
  const existingRequest = await commandResults.findOne({
    request_id: payload.requestId,
  });
  if (existingRequest) {
    if (existingRequest.request_hash !== hash)
      throw new ApiError(
        409,
        'MESSAGE_CONFLICT',
        'Request id was reused with another payload.',
      );
    await connection
      .collection('outbox')
      .updateOne(
        { message_id: existingRequest.response_message_id },
        { $set: { published_at: null } },
      );
    return existingRequest.response;
  }
  const Appointment = getAppointmentModel(connection);
  const QueueTicket = getQueueTicketModel(connection);
  const Inbox = getInboxModel(connection);
  const Outbox = getOutboxModel(connection);
  try {
    return await withMongoTransaction(connection, async (session) => {
      await Inbox.create(
        [
          {
            message_id: message.messageId,
            consumer_name: consumerName,
            payload_hash: hash,
            received_at: now,
          },
        ],
        { session },
      );
      const ticket = await QueueTicket.findOne({ id: payload.ticketId })
        .session(session)
        .lean();
      const rejection = (
        reasonCode,
        aggregateVersion = ticket?.version || 1,
      ) => ({
        requestId: payload.requestId,
        ticketId: payload.ticketId,
        appointmentId: ticket?.appointmentId || null,
        patientId: payload.patientId,
        state: 'REJECTED',
        reasonCode,
        version: aggregateVersion,
      });
      let response;
      let eventPayload;
      if (!ticket) {
        response = rejection('QUEUE_TICKET_NOT_FOUND');
        eventPayload = {
          ...payload,
          appointmentId: payload.appointmentId || null,
        };
      } else if (
        ticket.patientId !== payload.patientId ||
        ticket.doctorId !== payload.doctorId
      ) {
        response = rejection('TICKET_ASSIGNMENT_MISMATCH', ticket.version);
        eventPayload = {
          ...payload,
          appointmentId: ticket.appointmentId,
          patientId: ticket.patientId,
        };
      } else if (ticket.version !== payload.expectedTicketVersion) {
        response = rejection('VERSION_CONFLICT', ticket.version);
        eventPayload = {
          ...payload,
          appointmentId: ticket.appointmentId,
          patientId: ticket.patientId,
        };
      } else if (!['WAITING', 'CALLED'].includes(ticket.state)) {
        response = rejection('QUEUE_STATE_CONFLICT', ticket.version);
        eventPayload = {
          ...payload,
          appointmentId: ticket.appointmentId,
          patientId: ticket.patientId,
        };
      } else {
        const claimId = createId();
        const visitId =
          ticket.ticketType === 'RETURN' ? ticket.visitId : undefined;
        const changed = await QueueTicket.updateOne(
          {
            id: ticket.id,
            state: { $in: ['WAITING', 'CALLED'] },
            version: ticket.version,
          },
          {
            $set: {
              state: 'CLAIMED',
              claimId,
              ...(visitId ? { visitId } : {}),
              claimedAt: now,
              updatedAt: now,
            },
            $push: {
              stateHistory: { state: 'CLAIMED', at: now, by: payload.doctorId },
            },
            $inc: { version: 1 },
          },
          { session },
        );
        if (!changed.modifiedCount)
          throw new ApiError(409, 'VERSION_CONFLICT', 'Queue ticket changed.');
        await enqueueClinicalTicket(
          connection,
          session,
          { ...ticket, state: 'CLAIMED', version: ticket.version + 1 },
          now,
          message,
        );
        if (ticket.ticketType === 'FIRST') {
          await Appointment.updateOne(
            { id: ticket.appointmentId, state: 'CHECKED_IN' },
            {
              $set: {
                state: 'IN_SERVICE',
                ...(visitId ? { visitId } : {}),
                updatedAt: now,
              },
              $push: { stateHistory: { state: 'IN_SERVICE', at: now } },
              $inc: { version: 1 },
            },
            { session },
          );
        }
        response = {
          requestId: payload.requestId,
          ticketId: ticket.id,
          appointmentId: ticket.appointmentId,
          patientId: ticket.patientId,
          state: 'ACCEPTED',
          claimId,
          ...(visitId ? { visitId } : {}),
          version: ticket.version + 1,
        };
        eventPayload = {
          ...payload,
          appointmentId: ticket.appointmentId,
          patientId: ticket.patientId,
          visitId,
          claimId,
        };
      }
      const responseMessage = envelopeFor({
        message,
        payload: eventPayload,
        state: response.state,
        claimId: response.claimId,
        reasonCode: response.reasonCode,
        aggregateVersion: response.version,
        now,
      });
      await commandResults.insertOne(
        {
          command_id: message.messageId,
          request_id: payload.requestId,
          request_hash: hash,
          response,
          response_message_id: responseMessage.message_id,
          created_at: now,
        },
        { session },
      );
      await Outbox.create([responseMessage], { session });
      return response;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const raced = await commandResults.findOne({
        request_id: payload.requestId,
      });
      if (raced) {
        if (raced.request_hash !== hash)
          throw new ApiError(
            409,
            'MESSAGE_CONFLICT',
            'Request id was reused with another payload.',
          );
        return raced.response;
      }
    }
    throw error;
  }
}

async function handleClinicalMessage({
  connection,
  message,
  now = new Date(),
  consumerName = 'appointment-clinical',
}) {
  if (!message?.messageId || !message?.messageType || !message?.payload)
    throw new ApiError(
      400,
      'INVALID_MESSAGE',
      'Clinical message is incomplete.',
    );
  const Inbox = getInboxModel(connection);
  const existing = await Inbox.findOne({
    message_id: message.messageId,
    consumer_name: consumerName,
  }).lean();
  const hash = hashPayload(message.payload);
  if (existing) {
    if (existing.payload_hash && existing.payload_hash !== hash)
      throw new ApiError(
        409,
        'MESSAGE_CONFLICT',
        'MessageId was reused with another payload.',
      );
    return { duplicate: true };
  }
  const Appointment = getAppointmentModel(connection);
  const QueueTicket = getQueueTicketModel(connection);
  return withMongoTransaction(connection, async (session) => {
    await Inbox.create(
      [
        {
          message_id: message.messageId,
          consumer_name: consumerName,
          payload_hash: hash,
          received_at: now,
        },
      ],
      { session },
    );
    const payload = message.payload;
    if (message.messageType === 'QueueTicketClaimed') {
      const ticket = await QueueTicket.findOne({ id: payload.ticketId })
        .session(session)
        .lean();
      if (!ticket)
        throw new ApiError(
          404,
          'QUEUE_TICKET_NOT_FOUND',
          'Queue ticket not found.',
        );
      if (
        ticket.appointmentId !== payload.appointmentId ||
        ticket.patientId !== payload.patientId
      )
        throw new ApiError(
          409,
          'QUEUE_TICKET_MISMATCH',
          'Claim does not match the queue ticket.',
        );
      if (payload.state === 'REJECTED')
        return { duplicate: false, state: 'REJECTED' };
      if (payload.state !== 'ACCEPTED' || !payload.claimId)
        throw new ApiError(
          400,
          'INVALID_MESSAGE',
          'QueueTicketClaimed state is invalid.',
        );
      if (ticket.state === 'CLAIMED' && ticket.claimId === payload.claimId)
        return {
          duplicate: false,
          state: 'ACCEPTED',
          claimId: payload.claimId,
        };
      if (!['CALLED', 'WAITING'].includes(ticket.state))
        throw new ApiError(
          409,
          'QUEUE_STATE_CONFLICT',
          'Queue ticket cannot be claimed.',
        );
      const changed = await QueueTicket.updateOne(
        {
          id: ticket.id,
          state: { $in: ['CALLED', 'WAITING'] },
          version: ticket.version,
        },
        {
          $set: {
            state: 'CLAIMED',
            claimId: payload.claimId,
            visitId: payload.visitId || undefined,
            claimedAt: now,
            updatedAt: now,
          },
          $push: {
            stateHistory: {
              state: 'CLAIMED',
              at: now,
              by: payload.doctorUserId || null,
            },
          },
          $inc: { version: 1 },
        },
        { session },
      );
      if (!changed.modifiedCount)
        throw new ApiError(409, 'VERSION_CONFLICT', 'Queue ticket changed.');
      await enqueueClinicalTicket(
        connection,
        session,
        { ...ticket, state: 'CLAIMED', version: ticket.version + 1 },
        now,
        message,
      );
      await Appointment.updateOne(
        { id: ticket.appointmentId, state: 'CHECKED_IN' },
        {
          $set: {
            state: 'IN_SERVICE',
            visitId: payload.visitId || null,
            updatedAt: now,
          },
          $push: { stateHistory: { state: 'IN_SERVICE', at: now } },
          $inc: { version: 1 },
        },
        { session },
      );
      return { duplicate: false, state: 'ACCEPTED', claimId: payload.claimId };
    }
    if (message.messageType === 'VisitSigned') {
      if (!payload.appointmentId || !payload.visitId)
        throw new ApiError(
          400,
          'INVALID_MESSAGE',
          'VisitSigned payload is incomplete.',
        );
      const appointment = await Appointment.findOne({
        id: payload.appointmentId,
      })
        .session(session)
        .lean();
      if (!appointment)
        throw new ApiError(404, 'NOT_FOUND', 'Appointment not found.');
      if (appointment.visitId && appointment.visitId !== payload.visitId)
        throw new ApiError(
          409,
          'VISIT_MISMATCH',
          'Visit does not match appointment.',
        );
      await Appointment.updateOne(
        { id: appointment.id, state: { $in: ['IN_SERVICE', 'CHECKED_IN'] } },
        {
          $set: {
            state: 'COMPLETED',
            visitId: payload.visitId,
            updatedAt: now,
          },
          $push: { stateHistory: { state: 'COMPLETED', at: now } },
          $inc: { version: 1 },
        },
        { session },
      );
      const completing = {
        appointmentId: appointment.id,
        state: { $in: ['CLAIMED', 'IN_SERVICE'] },
      };
      const tickets = await QueueTicket.find(completing)
        .session(session)
        .lean();
      await QueueTicket.updateMany(
        completing,
        {
          $set: { state: 'DONE', completedAt: now, updatedAt: now },
          $push: { stateHistory: { state: 'DONE', at: now } },
          $inc: { version: 1 },
        },
        { session },
      );
      for (const ticket of tickets) {
        await enqueueClinicalTicket(
          connection,
          session,
          { ...ticket, state: 'DONE', version: ticket.version + 1 },
          now,
          message,
        );
      }
      return { duplicate: false, state: 'COMPLETED' };
    }
    if (message.messageType === 'VisitReturnReady') {
      if (
        !payload.appointmentId ||
        !payload.visitId ||
        !Number.isInteger(payload.returnRound) ||
        payload.returnRound < 1
      )
        throw new ApiError(
          400,
          'INVALID_MESSAGE',
          'VisitReturnReady payload is incomplete.',
        );
      const appointment = await Appointment.findOne({
        id: payload.appointmentId,
      })
        .session(session)
        .lean();
      if (!appointment)
        throw new ApiError(404, 'NOT_FOUND', 'Appointment not found.');
      if (appointment.visitId && appointment.visitId !== payload.visitId)
        throw new ApiError(
          409,
          'VISIT_MISMATCH',
          'Return visit does not match appointment.',
        );
      const existingTicket = await QueueTicket.findOne({
        appointmentId: appointment.id,
        ticketType: 'RETURN',
        returnRound: payload.returnRound,
      })
        .session(session)
        .lean();
      if (existingTicket)
        return {
          duplicate: false,
          state: 'READY',
          ticketId: existingTicket.id,
          returnRound: payload.returnRound,
        };
      const ticket = {
        id: randomUUID(),
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        doctorUserId: appointment.doctorUserId,
        departmentId: appointment.departmentId,
        ticketType: 'RETURN',
        returnRound: payload.returnRound,
        appointmentDate: vietnamDate(now),
        state: 'WAITING',
        visitId: payload.visitId,
        version: 1,
        stateHistory: [
          { state: 'WAITING', at: now, reasonCode: 'VISIT_RETURN_READY' },
        ],
        createdAt: now,
        updatedAt: now,
      };
      await QueueTicket.create([ticket], { session });
      await enqueueClinicalTicket(connection, session, ticket, now, message);
      return {
        duplicate: false,
        state: 'READY',
        ticketId: ticket.id,
        returnRound: payload.returnRound,
      };
    }
    throw new ApiError(400, 'INVALID_MESSAGE', 'Unsupported Clinical message.');
  });
}

function vietnamDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : null;
}

module.exports = { handleClinicalMessage, handleClaimQueueTicketCommand };
