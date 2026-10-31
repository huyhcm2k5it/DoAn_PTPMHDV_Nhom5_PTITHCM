const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const {
  getAppointmentModel,
  getInboxModel,
  getSettlementDecisionModel,
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
        [{ message_id: message.messageId, consumer_name: consumerName, received_at: now }],
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
        if (payload.state === 'ACCEPTED')
          await Appointment.updateOne(
            { id: appointment.id, state: 'PENDING_PAYMENT' },
            {
              $set: {
                state: 'SETTLEMENT_LOCKED',
                settlementId: payload.settlementId,
                fence: payload.fence,
              },
              $inc: { version: 1 },
            },
            { session },
          );
        else if (payload.state !== 'REJECTED')
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
              $set: { state: 'PENDING_PAYMENT', settlementId: null, fence: null },
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
        if (
          appointment.priceSnapshot?.amountVnd != null &&
          Number(appointment.priceSnapshot.amountVnd) !== Number(payload.amountVnd)
        )
          throw new ApiError(
            409,
            'AMOUNT_MISMATCH',
            'Payment amount does not match the accepted snapshot.',
          );
        await Appointment.updateOne(
          { id: appointment.id, state: 'SETTLEMENT_LOCKED', fence: payload.fence },
          { $set: { state: 'CONFIRMED', chargeStatus: 'PAID' }, $inc: { version: 1 } },
          { session },
        );
      } else throw new ApiError(400, 'INVALID_MESSAGE', 'Unsupported Billing message.');
      return { duplicate: false };
    });
  } catch (error) {
    if (error?.code === 11000) return { duplicate: true };
    throw error;
  }
}
module.exports = { handleBillingMessage, assertSource };
