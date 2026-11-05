const { createHash, randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const {
  getAppointmentModel,
  getSlotModel,
  getInboxModel,
  getSettlementDecisionModel,
  getOutboxModel,
} = require('../models/appointment.model.js');
const { ApiError } = require('../core/errors.js');

function assertSource(appointment, payload) {
  if (
    !appointment ||
    payload.sourceType !== 'APPOINTMENT' ||
    payload.sourceId !== appointment.id ||
    Number(payload.sourceRevision) !== appointment.sourceRevision
  )
    throw new ApiError(
      409,
      'SOURCE_MISMATCH',
      'Billing message does not match the local appointment revision.',
    );
}

function payloadHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function handleReserveSettlementCommand({
  connection,
  message,
  now = new Date(),
  consumerName = 'appointment-settlement-command',
}) {
  if (!message?.messageId || message.messageKind !== 'COMMAND' || message.messageType !== 'ReserveSettlement')
    throw new ApiError(400, 'INVALID_MESSAGE', 'ReserveSettlement command is incomplete.');
  const Appointment = getAppointmentModel(connection);
  const Inbox = getInboxModel(connection);
  const Outbox = getOutboxModel(connection);
  const hash = payloadHash(message.payload);
  const existing = await Inbox.findOne({ message_id: message.messageId, consumer_name: consumerName }).lean();
  if (existing) {
    if (existing.payload_hash && existing.payload_hash !== hash)
      throw new ApiError(409, 'MESSAGE_CONFLICT', 'MessageId was reused with another payload.');
    return { duplicate: true };
  }
  return withMongoTransaction(connection, async (session) => {
    await Inbox.create([{ message_id: message.messageId, consumer_name: consumerName, payload_hash: hash, received_at: now }], { session });
    const payload = message.payload || {};
    const appointment = await Appointment.findOne({ id: payload.sourceId }).session(session).lean();
    assertSource(appointment, payload);
    if (!payload.settlementId || !payload.chargeId || appointment.chargeId !== payload.chargeId)
      throw new ApiError(409, 'SETTLEMENT_MISMATCH', 'ReserveSettlement does not match the charge.');
    if (!['PENDING_PAYMENT', 'SETTLEMENT_LOCKED'].includes(appointment.state))
      throw new ApiError(409, 'SETTLEMENT_STATE_CONFLICT', 'Appointment cannot reserve settlement now.');
    if (appointment.state === 'SETTLEMENT_LOCKED' && appointment.settlementId === payload.settlementId)
      return { duplicate: false, state: 'ACCEPTED', settlementId: payload.settlementId, fence: appointment.fence };
    const fence = Number.isInteger(appointment.fence) && appointment.fence > 0 ? appointment.fence + 1 : 1;
    const changed = await Appointment.updateOne(
      { id: appointment.id, state: 'PENDING_PAYMENT' },
      { $set: { state: 'SETTLEMENT_LOCKED', settlementId: payload.settlementId, fence, updatedAt: now }, $push: { stateHistory: { state: 'SETTLEMENT_LOCKED', at: now } }, $inc: { version: 1 } },
      { session },
    );
    if (!changed.modifiedCount) throw new ApiError(409, 'VERSION_CONFLICT', 'Appointment changed.');
    await Outbox.create([{
      message_id: randomUUID(),
      message_kind: 'EVENT',
      message_type: 'SettlementReserved',
      schema_version: 1,
      producer: 'Appointment',
      aggregate_id: appointment.id,
      aggregate_version: appointment.version + 1,
      correlation_id: message.correlationId || randomUUID(),
      occurred_at: now,
      payload: {
        requestId: payload.requestId || null,
        sourceType: 'APPOINTMENT',
        sourceId: appointment.id,
        sourceRevision: appointment.sourceRevision,
        chargeId: appointment.chargeId,
        settlementId: payload.settlementId,
        state: 'ACCEPTED',
        fence,
        amountVnd: appointment.priceSnapshot?.amountVnd ?? null,
      },
    }], { session });
    return { duplicate: false, state: 'ACCEPTED', settlementId: payload.settlementId, fence };
  });
}
async function handleBillingMessage({
  connection,
  message,
  now = new Date(),
  consumerName = 'appointment-billing',
}) {
  if (!message?.messageId || !message?.messageType || !message?.payload)
    throw new ApiError(400, 'INVALID_MESSAGE', 'Billing message is incomplete.');
  const Appointment = getAppointmentModel(connection);
  const Inbox = getInboxModel(connection);
  const Decision = getSettlementDecisionModel(connection);
  if (await Inbox.findOne({ message_id: message.messageId, consumer_name: consumerName }).lean())
    return { duplicate: true };
  try {
    return await withMongoTransaction(connection, async (session) => {
      await Inbox.create(
        [{ message_id: message.messageId, consumer_name: consumerName, payload_hash: payloadHash(message.payload), received_at: now }],
        { session },
      );
      const payload = message.payload;
      if (message.messageType === 'ChargePrepared') {
        const appointment = await Appointment.findOne({ id: payload.sourceId })
          .session(session)
          .lean();
        assertSource(appointment, payload);
        if (payload.state === 'CREATED')
          await Appointment.updateOne(
            { id: appointment.id, chargeSync: 'PENDING' },
            {
              $set: { chargeSync: 'CREATED', chargeId: payload.chargeId, chargeStatus: 'OPEN' },
              $inc: { version: 1 },
            },
            { session },
          );
        else if (payload.state === 'REJECTED')
          await Appointment.updateOne(
            { id: appointment.id, chargeSync: 'PENDING' },
            { $set: { chargeSync: 'REJECTED', chargeStatus: 'REJECTED' }, $inc: { version: 1 } },
            { session },
          );
        else throw new ApiError(400, 'INVALID_MESSAGE', 'Unsupported ChargePrepared state.');
      } else if (message.messageType === 'SettlementReserved') {
        const appointment = await Appointment.findOne({ id: payload.sourceId })
          .session(session)
          .lean();
        assertSource(appointment, payload);
        if (payload.state === 'ACCEPTED') {
          if (!Number.isInteger(payload.fence) || payload.fence < 1)
            throw new ApiError(400, 'INVALID_MESSAGE', 'Settlement fence must be a positive integer.');
          await Appointment.updateOne(
            { id: appointment.id, state: 'PENDING_PAYMENT' },
            {
              $set: {
                state: 'SETTLEMENT_LOCKED',
                settlementId: payload.settlementId,
                fence: payload.fence,
                updatedAt: now,
              },
              $push: { stateHistory: { state: 'SETTLEMENT_LOCKED', at: now } },
              $inc: { version: 1 },
            },
            { session },
          );
        } else if (payload.state !== 'REJECTED')
          throw new ApiError(400, 'INVALID_MESSAGE', 'Unsupported SettlementReserved state.');
      } else if (message.messageType === 'SettlementDecision') {
        const appointment = await Appointment.findOne({ id: payload.sourceId })
          .session(session)
          .lean();
        assertSource(appointment, payload);
        await Decision.updateOne(
          { settlementId: payload.settlementId, decisionVersion: payload.decisionVersion },
          {
            $setOnInsert: {
              id: message.messageId,
              settlementId: payload.settlementId,
              sourceId: payload.sourceId,
              sourceRevision: payload.sourceRevision,
              decisionVersion: payload.decisionVersion,
              state: payload.state,
              fence: payload.fence,
              paymentId: payload.paymentId,
              createdAt: now,
            },
          },
          { upsert: true, session },
        );
        if (
          payload.state === 'FAILED' &&
          appointment.state === 'SETTLEMENT_LOCKED' &&
          appointment.fence === payload.fence
        )
          await Appointment.updateOne(
            { id: appointment.id, state: 'SETTLEMENT_LOCKED', fence: payload.fence },
            {
              $set: { state: 'PENDING_PAYMENT', settlementId: null, fence: null, updatedAt: now },
              $push: { stateHistory: { state: 'PENDING_PAYMENT', at: now, reasonCode: 'SETTLEMENT_FAILED' } },
              $inc: { version: 1 },
            },
            { session },
          );
      } else if (message.messageType === 'ChargePaid') {
        const appointment = await Appointment.findOne({ id: payload.sourceId })
          .session(session)
          .lean();
        assertSource(appointment, payload);
        if (
          appointment.state !== 'SETTLEMENT_LOCKED' ||
          appointment.settlementId !== payload.settlementId ||
          appointment.fence !== payload.fence ||
          appointment.chargeId !== payload.chargeId
        )
          throw new ApiError(
            409,
            'SETTLEMENT_MISMATCH',
            'Payment evidence does not match the locked appointment.',
          );
        if (!Number.isInteger(payload.fence) || payload.fence < 1)
          throw new ApiError(400, 'INVALID_MESSAGE', 'Payment fence must be a positive integer.');
        if (
          appointment.priceSnapshot?.amountVnd != null &&
          Number(appointment.priceSnapshot.amountVnd) !== Number(payload.amountVnd)
        )
          throw new ApiError(
            409,
            'AMOUNT_MISMATCH',
            'Payment amount does not match the accepted snapshot.',
          );
        const changed = await Appointment.updateOne(
          { id: appointment.id, state: 'SETTLEMENT_LOCKED', fence: payload.fence },
          { $set: { state: 'CONFIRMED', chargeStatus: 'PAID', updatedAt: now }, $push: { stateHistory: { state: 'CONFIRMED', at: now, by: 'Billing' } }, $inc: { version: 1 } },
          { session },
        );
        if (!changed.modifiedCount) return { duplicate: false };
        const Slot = getSlotModel(connection);
        const slotChanged = await Slot.updateOne(
          { id: appointment.slotId, heldCount: { $gt: 0 } },
          { $inc: { heldCount: -1, confirmedCount: 1 } },
          { session },
        );
        if (!slotChanged.modifiedCount)
          throw new ApiError(
            500,
            'CAPACITY_INVARIANT_BROKEN',
            'Slot counters cannot confirm the appointment.',
          );
      } else throw new ApiError(400, 'INVALID_MESSAGE', 'Unsupported Billing message.');
      return { duplicate: false };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const raced = await Inbox.findOne({
        message_id: message.messageId,
        consumer_name: consumerName,
      }).lean();
      if (raced) {
        if (raced.payload_hash && raced.payload_hash !== payloadHash(message.payload))
          throw new ApiError(409, 'MESSAGE_CONFLICT', 'MessageId was reused with another payload.');
        return { duplicate: true };
      }
    }
    throw error;
  }
}
module.exports = { handleBillingMessage, handleReserveSettlementCommand, assertSource };
