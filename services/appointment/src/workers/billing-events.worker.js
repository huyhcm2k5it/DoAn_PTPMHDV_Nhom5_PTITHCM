const { createHash, randomUUID } = require('node:crypto');
const {
  refreshPatientIntervals,
} = require('../services/patient-time-lock.service');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const {
  getAppointmentModel,
  getHoldModel,
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
      const expiresAt = a?.expiresAt ?? a?.paymentDueAt;
      const acceptedSnapshot =
        a?.priceSnapshot ??
        (a
          ? (
              await getHoldModel(connection)
                .findOne({ id: a.holdId })
                .select('priceSnapshot')
                .session(session)
                .lean()
            )?.priceSnapshot
          : undefined);
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
          (a.state !== 'PENDING_PAYMENT' || !expiresAt || expiresAt <= now))
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
        !acceptedSnapshot?.snapshotHash ||
        p.amountHash !== acceptedSnapshot.snapshotHash ||
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
              settlementState: 'PENDING',
              settlementVersion: 0,
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
        await refreshPatientIntervals(connection, a.patientId, session);
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
                    amountHash: acceptedSnapshot.snapshotHash,
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
  const identity = {
    message_id: message.messageId,
    consumer_name: consumerName,
  };
  const fingerprint = payloadHash(message.payload);
  async function alreadyProcessed() {
    const delivery = await Inbox.findOne(identity).lean();
    if (delivery?.payload_hash && delivery.payload_hash !== fingerprint)
      throw new ApiError(
        409,
        'MESSAGE_CONFLICT',
        'MessageId was reused with another payload.',
      );
    return Boolean(delivery);
  }

  if (await alreadyProcessed()) return { duplicate: true };
  const processMessage = () =>
    withMongoTransaction(connection, async (session) => {
      await Inbox.create(
        [
          {
            ...identity,
            payload_hash: fingerprint,
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
        const refundVersion = Math.max(
          appointment.refundVersion ?? 0,
          appointment.billingStatusVersion ?? 0,
        );
        if (refundVersion < payload.version) {
          await Appointment.updateOne(
            { id: appointment.id },
            {
              $set: {
                refundVersion: payload.version,
                ...(payload.refundStatus
                  ? { refundStatus: payload.refundStatus }
                  : {}),
              },
            },
            { session },
          );
        }
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
                chargeStatus: appointment.state === 'EXPIRED' ? 'VOID' : 'OPEN',
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
                settlementState: 'PENDING',
                settlementVersion: 0,
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
        if (
          typeof payload.settlementId !== 'string' ||
          !payload.settlementId ||
          !Number.isSafeInteger(payload.decisionVersion) ||
          payload.decisionVersion < 1 ||
          !['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(payload.state) ||
          (payload.fence != null &&
            (!Number.isSafeInteger(payload.fence) || payload.fence < 1))
        )
          throw new ApiError(
            400,
            'INVALID_MESSAGE',
            'Invalid settlement decision.',
          );

        const decisionKey = {
          settlementId: payload.settlementId,
          decisionVersion: payload.decisionVersion,
        };
        const decision = await Decision.findOne(decisionKey)
          .session(session)
          .lean();
        if (
          decision &&
          ['sourceId', 'sourceRevision', 'state', 'fence', 'paymentId'].some(
            (field) => (decision[field] ?? null) !== (payload[field] ?? null),
          )
        )
          throw new ApiError(
            409,
            'MESSAGE_CONFLICT',
            'Settlement decision changed.',
          );
        if (!decision)
          await Decision.create(
            [
              {
                ...decisionKey,
                id: message.messageId,
                sourceId: payload.sourceId,
                sourceRevision: payload.sourceRevision,
                state: payload.state,
                fence: payload.fence,
                paymentId: payload.paymentId,
                createdAt: now,
              },
            ],
            { session },
          );

        const activeSettlement =
          appointment.settlementId === payload.settlementId &&
          ((Number.isSafeInteger(appointment.fence) &&
            appointment.fence > 0 &&
            appointment.fence === payload.fence) ||
            (payload.state === 'UNKNOWN' && payload.fence == null));
        const newerDecision =
          payload.decisionVersion > (appointment.settlementVersion ?? -1);
        const locked = appointment.state === 'SETTLEMENT_LOCKED';
        const confirmed = appointment.state === 'CONFIRMED';
        const compatibleDecision =
          appointment.settlementState !== 'SUCCEEDED' ||
          payload.state === 'SUCCEEDED';
        if (
          activeSettlement &&
          newerDecision &&
          compatibleDecision &&
          (locked || (confirmed && payload.state === 'SUCCEEDED'))
        ) {
          const failed = payload.state === 'FAILED';
          await Appointment.updateOne(
            { id: appointment.id, version: appointment.version },
            {
              $set: {
                settlementState: payload.state,
                settlementVersion: payload.decisionVersion,
                updatedAt: now,
                ...(failed
                  ? {
                      state: 'PENDING_PAYMENT',
                      settlementId: null,
                      fence: null,
                    }
                  : {}),
              },
              ...(failed
                ? {
                    $push: {
                      stateHistory: {
                        state: 'PENDING_PAYMENT',
                        at: now,
                        reasonCode: 'SETTLEMENT_FAILED',
                      },
                    },
                  }
                : {}),
              $inc: { version: 1 },
            },
            { session },
          );
          if (failed)
            await refreshPatientIntervals(
              connection,
              appointment.patientId,
              session,
            );
        }
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
        const acceptedAmount =
          appointment.priceSnapshotVnd ?? appointment.priceSnapshot?.amountVnd;
        if (
          acceptedAmount != null &&
          Number(acceptedAmount) !== Number(payload.amountVnd)
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
            $set: {
              state: 'CONFIRMED',
              chargeStatus: 'PAID',
              settlementState: 'SUCCEEDED',
              updatedAt: now,
            },
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
          { $inc: { heldCount: -1, confirmedCount: 1, version: 1 } },
          { session },
        );
        if (!slotChanged.modifiedCount)
          throw new ApiError(
            500,
            'CAPACITY_INVARIANT_BROKEN',
            'Slot counters cannot confirm the appointment.',
          );
        const recipientUserId =
          appointment.recipientUserId ??
          (
            await connection
              .collection('patient_access_projection')
              .findOne(
                { patientId: appointment.patientId, active: true },
                { session },
              )
          )?.ownerUserId;
        if (!recipientUserId)
          throw new ApiError(
            503,
            'AUTH_PROJECTION_UNAVAILABLE',
            'Cannot route appointment confirmation.',
          );
        const version = appointment.version + 1;
        await refreshPatientIntervals(
          connection,
          appointment.patientId,
          session,
        );
        await getOutboxModel(connection).create(
          [
            {
              message_id: randomUUID(),
              message_kind: 'EVENT',
              message_type: 'AppointmentChanged',
              schema_version: 1,
              producer: 'appointment',
              aggregate_id: appointment.id,
              aggregate_version: version,
              correlation_id: message.correlationId || appointment.requestId,
              request_id: appointment.requestId,
              causation_id: message.messageId,
              occurred_at: now,
              payload: {
                appointmentId: appointment.id,
                patientId: appointment.patientId,
                recipientUserId,
                changeType: 'CONFIRMED',
                version,
              },
            },
          ],
          { session },
        );
      } else
        throw new ApiError(
          400,
          'INVALID_MESSAGE',
          'Unsupported Billing message.',
        );
      return { duplicate: false };
    });
  try {
    return await processMessage();
  } catch (error) {
    if (error?.code !== 11000) throw error;
    if (await alreadyProcessed()) return { duplicate: true };
    if (
      message.messageType === 'SettlementDecision' &&
      error.keyPattern?.settlementId &&
      error.keyPattern?.decisionVersion
    )
      return processMessage();
    throw error;
  }
}

module.exports = {
  handleBillingMessage,
  handleReserveSettlementCommand,
  assertSource,
};
