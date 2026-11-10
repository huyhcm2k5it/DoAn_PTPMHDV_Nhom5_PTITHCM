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
}) {
  if (
    !message?.messageId ||
    message.messageKind !== 'COMMAND' ||
    message.messageType !== 'ReserveSettlement'
  )
    throw new ApiError(
      400,
      'INVALID_MESSAGE',
      'ReserveSettlement command is incomplete.',
    );
  const p = message.payload || {};
  if (
    !p.settlementId ||
    !p.sourceId ||
    (message.saga && message.saga.id !== p.settlementId)
  )
    throw new ApiError(
      400,
      'INVALID_MESSAGE',
      'Settlement identity is incomplete.',
    );
  const results = connection.collection('command_results');
  const intent =
    'ReserveSettlement:' +
    p.sourceId +
    ':' +
    p.sourceRevision +
    ':' +
    p.settlementId;
  const hash = payloadHash(p);
  const replay = async (session) => {
    const prior = await results.findOne({ request_id: intent }, { session });
    if (!prior) return null;
    if (prior.request_hash !== hash)
      throw new ApiError(409, 'MESSAGE_CONFLICT', 'Settlement intent changed.');
    await connection
      .collection('outbox')
      .updateOne(
        { message_id: prior.response_message_id },
        { $set: { published_at: null, next_attempt_at: null } },
        { session },
      );
    return prior.response;
  };
  try {
    return await withMongoTransaction(connection, async (session) => {
      const prior = await replay(session);
      if (prior) return prior;
      const Appointment = getAppointmentModel(connection);
      const a = await Appointment.findOne({ id: p.sourceId })
        .session(session)
        .lean();
      const failed = await getSettlementDecisionModel(connection)
        .findOne({
          sourceId: p.sourceId,
          sourceRevision: p.sourceRevision,
          settlementId: p.settlementId,
          state: 'FAILED',
        })
        .session(session)
        .lean();
      const locked =
        a?.state === 'SETTLEMENT_LOCKED' && a.settlementId === p.settlementId;
      let reasonCode;
      if (
        !a ||
        p.sourceType !== 'APPOINTMENT' ||
        p.sourceRevision !== a.sourceRevision
      )
        reasonCode = 'SOURCE_MISMATCH';
      else if (
        failed ||
        (!locked &&
          (a.state !== 'PENDING_PAYMENT' ||
            !a.paymentDueAt ||
            a.paymentDueAt <= now))
      )
        reasonCode = 'SOURCE_EXPIRED_OR_CLOSED';
      else if (!a.chargeId && a.chargeSync === 'PENDING')
        throw new ApiError(
          503,
          'CHARGE_PENDING_SYNC',
          'ChargePrepared has not reached this owner.',
        );
      else if (
        p.chargeId !== a.chargeId ||
        p.amountHash !== a.priceSnapshot?.snapshotHash ||
        !Number.isSafeInteger(p.attemptVersion) ||
        p.attemptVersion !==
          (locked
            ? a.reserveAttemptVersion
            : (a.reserveAttemptVersion || 0) + 1)
      )
        reasonCode = 'SETTLEMENT_MISMATCH';
      const fence = locked ? a.fence : (a?.fenceCounter || a?.fence || 0) + 1;
      const response = {
        state: reasonCode ? 'REJECTED' : 'ACCEPTED',
        settlementId: p.settlementId,
        ...(reasonCode ? { reasonCode } : { fence }),
      };
      if (!reasonCode && !locked) {
        const changed = await Appointment.updateOne(
          { id: a.id, state: 'PENDING_PAYMENT', version: a.version },
          {
            $set: {
              state: 'SETTLEMENT_LOCKED',
              settlementId: p.settlementId,
              fence,
              fenceCounter: fence,
              reserveAttemptVersion: p.attemptVersion,
              updatedAt: now,
            },
            $push: { stateHistory: { state: 'SETTLEMENT_LOCKED', at: now } },
            $inc: { version: 1 },
          },
          { session },
        );
        if (!changed.modifiedCount)
          throw new ApiError(409, 'VERSION_CONFLICT', 'Appointment changed.');
      }
      const responseId = randomUUID();
      await getOutboxModel(connection).create(
        [
          {
            message_id: responseId,
            message_kind: 'EVENT',
            message_type: 'SettlementReserved',
            schema_version: 1,
            producer: 'appointment',
            aggregate_id: p.sourceId,
            aggregate_version: a?.version || 1,
            correlation_id: message.correlationId || message.messageId,
            request_id: message.requestId || p.requestId || message.messageId,
            causation_id: message.messageId,
            occurred_at: now,
            payload: {
              sourceType: 'APPOINTMENT',
              sourceId: p.sourceId,
              sourceRevision: p.sourceRevision,
              chargeId: p.chargeId,
              ...response,
              ...(reasonCode
                ? {}
                : {
                    amountHash: a.priceSnapshot.snapshotHash,
                    lockedAt: now.toISOString(),
                  }),
            },
          },
        ],
        { session },
      );
      await results.insertOne(
        {
          command_id: message.messageId,
          request_id: intent,
          request_hash: hash,
          response,
          response_message_id: responseId,
          created_at: now,
        },
        { session },
      );
      return response;
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await replay();
      if (prior) return prior;
    }
    throw error;
  }
}
async function handleBillingMessage({
  connection,
  message,
  now = new Date(),
  consumerName = 'appointment-billing',
}) {
  if (!message?.messageId || !message?.messageType || !message?.payload)
    throw new ApiError(
      400,
      'INVALID_MESSAGE',
      'Billing message is incomplete.',
    );
  const Appointment = getAppointmentModel(connection);
  const Inbox = getInboxModel(connection);
  const Decision = getSettlementDecisionModel(connection);
  if (
    await Inbox.findOne({
      message_id: message.messageId,
      consumer_name: consumerName,
    }).lean()
  )
    return { duplicate: true };
  try {
    return await withMongoTransaction(connection, async (session) => {
      await Inbox.create(
        [
          {
            message_id: message.messageId,
            consumer_name: consumerName,
            payload_hash: payloadHash(message.payload),
            received_at: now,
          },
        ],
        { session },
      );
      const payload = message.payload;
      if (message.messageType === 'BillingStatusChanged') {
        if (
          message.producer !== 'billing' ||
          !Number.isSafeInteger(payload.version) ||
          payload.version < 1
        )
          throw new ApiError(
            400,
            'INVALID_MESSAGE',
            'Billing status source is invalid.',
          );
        const appointment = await Appointment.findOne({
          chargeId: payload.chargeId,
        })
          .session(session)
          .lean();
        if (!appointment)
          throw new ApiError(
            503,
            'SOURCE_PENDING_SYNC',
            'Charge is not synchronized.',
          );
        if (payload.sourceId && payload.sourceId !== appointment.id)
          throw new ApiError(409, 'SOURCE_MISMATCH', 'Billing source differs.');
        if ((appointment.billingStatusVersion || 0) < payload.version)
          await connection.collection('appointments').updateOne(
            { id: appointment.id },
            {
              $set: {
                billingStatusVersion: payload.version,
                refundStatus: payload.refundStatus || appointment.refundStatus,
                billingAsOf: payload.asOf || now.toISOString(),
              },
            },
            { session },
          );
      } else if (message.messageType === 'ChargePrepared') {
        const appointment = await Appointment.findOne({ id: payload.sourceId })
          .session(session)
          .lean();
        assertSource(appointment, payload);
        if (payload.state === 'CREATED')
          await Appointment.updateOne(
            { id: appointment.id, chargeSync: 'PENDING' },
            {
              $set: {
                chargeSync: 'CREATED',
                chargeId: payload.chargeId,
                chargeStatus: 'OPEN',
              },
              $inc: { version: 1 },
            },
            { session },
          );
        else if (payload.state === 'REJECTED')
          await Appointment.updateOne(
            { id: appointment.id, chargeSync: 'PENDING' },
            {
              $set: { chargeSync: 'REJECTED', chargeStatus: 'REJECTED' },
              $inc: { version: 1 },
            },
            { session },
          );
        else
          throw new ApiError(
            400,
            'INVALID_MESSAGE',
            'Unsupported ChargePrepared state.',
          );
      } else if (message.messageType === 'SettlementReserved') {
        const appointment = await Appointment.findOne({ id: payload.sourceId })
          .session(session)
          .lean();
        assertSource(appointment, payload);
        if (payload.state === 'ACCEPTED') {
          if (!Number.isInteger(payload.fence) || payload.fence < 1)
            throw new ApiError(
              400,
              'INVALID_MESSAGE',
              'Settlement fence must be a positive integer.',
            );
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
          throw new ApiError(
            400,
            'INVALID_MESSAGE',
            'Unsupported SettlementReserved state.',
          );
      } else if (message.messageType === 'SettlementDecision') {
        const appointment = await Appointment.findOne({ id: payload.sourceId })
          .session(session)
          .lean();
        assertSource(appointment, {
          ...payload,
          sourceType: payload.sourceType || 'APPOINTMENT',
        });
        await Decision.updateOne(
          {
            settlementId: payload.settlementId,
            decisionVersion: payload.decisionVersion,
          },
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
            {
              id: appointment.id,
              state: 'SETTLEMENT_LOCKED',
              fence: payload.fence,
            },
            {
              $set: {
                state: 'PENDING_PAYMENT',
                settlementId: null,
                fence: null,
                updatedAt: now,
              },
              $push: {
                stateHistory: {
                  state: 'PENDING_PAYMENT',
                  at: now,
                  reasonCode: 'SETTLEMENT_FAILED',
                },
              },
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
          throw new ApiError(
            400,
            'INVALID_MESSAGE',
            'Payment fence must be a positive integer.',
          );
        if (
          appointment.priceSnapshot?.amountVnd != null &&
          Number(appointment.priceSnapshot.amountVnd) !==
            Number(payload.amountVnd)
        )
          throw new ApiError(
            409,
            'AMOUNT_MISMATCH',
            'Payment amount does not match the accepted snapshot.',
          );
        const changed = await Appointment.updateOne(
          {
            id: appointment.id,
            state: 'SETTLEMENT_LOCKED',
            fence: payload.fence,
          },
          {
            $set: { state: 'CONFIRMED', chargeStatus: 'PAID', updatedAt: now },
            $push: {
              stateHistory: { state: 'CONFIRMED', at: now, by: 'Billing' },
            },
            $inc: { version: 1 },
          },
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
      } else
        throw new ApiError(
          400,
          'INVALID_MESSAGE',
          'Unsupported Billing message.',
        );
      return { duplicate: false };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const raced = await Inbox.findOne({
        message_id: message.messageId,
        consumer_name: consumerName,
      }).lean();
      if (raced) {
        if (
          raced.payload_hash &&
          raced.payload_hash !== payloadHash(message.payload)
        )
          throw new ApiError(
            409,
            'MESSAGE_CONFLICT',
            'MessageId was reused with another payload.',
          );
        return { duplicate: true };
      }
    }
    throw error;
  }
}
module.exports = {
  handleBillingMessage,
  handleReserveSettlementCommand,
  assertSource,
};
