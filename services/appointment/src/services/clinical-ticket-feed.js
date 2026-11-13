const { randomUUID } = require('node:crypto');
const { getOutboxModel } = require('../models/appointment.model.js');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clinicalTicketSnapshot(ticket) {
  const payload = { ticketId: ticket.id };
  for (const key of [
    'appointmentId',
    'patientId',
    'doctorId',
    'doctorUserId',
    'departmentId',
    'ticketType',
    'state',
    'version',
  ])
    payload[key] = ticket[key];
  if (ticket.ticketType === 'RETURN') payload.visitId = ticket.visitId;
  const ids = [
    'ticketId',
    'appointmentId',
    'patientId',
    'doctorId',
    'doctorUserId',
    'departmentId',
  ];
  if (ticket.ticketType === 'RETURN') ids.push('visitId');
  if (
    !ids.every(
      (key) => typeof payload[key] === 'string' && uuid.test(payload[key]),
    ) ||
    !['FIRST', 'RETURN'].includes(payload.ticketType) ||
    !['WAITING', 'CALLED', 'CLAIMED', 'IN_SERVICE', 'NO_SHOW', 'DONE'].includes(
      payload.state,
    ) ||
    !Number.isInteger(payload.version) ||
    payload.version < 1 ||
    payload.version > 2147483647
  )
    return null;
  return payload;
}

async function enqueueClinicalTicket(
  connection,
  session,
  ticket,
  now,
  cause = {},
) {
  const payload = clinicalTicketSnapshot(ticket);
  // Legacy tickets without the trusted Catalog mapping cannot authorize a claim.
  if (!payload) return false;
  const id = randomUUID();
  await getOutboxModel(connection).create(
    [
      {
        message_id: id,
        message_kind: 'EVENT',
        message_type: 'QueueTicketChanged',
        schema_version: 1,
        producer: 'appointment',
        aggregate_id: payload.ticketId,
        aggregate_version: payload.version,
        correlation_id: cause.correlationId || id,
        request_id: cause.requestId || id,
        causation_id: cause.messageId || id,
        occurred_at: now,
        payload,
      },
    ],
    { session },
  );
  return true;
}

module.exports = { clinicalTicketSnapshot, enqueueClinicalTicket };
