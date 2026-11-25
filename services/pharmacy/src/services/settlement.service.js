const { isForeignBillingEvent } = require('../../../../mongo/billing-scope');
const {
  loadMedicationHold,
  replaceMedicationHold,
  hydrateMedicationHold,
} = require('./medication-hold.repository');
const { randomUUID } = require('node:crypto');
const {
  consume,
  mutate,
  uuid,
  integer,
  failure,
  hash,
  outbox,
  pending,
} = require('./common');
const { returnReservation } = require('./medication-holds.service');

async function maybeCommit(connection, session, hold) {
  if (
    hold.status !== 'SETTLEMENT_LOCKED' ||
    !hold.paidEvidence ||
    hold.settlementState !== 'SUCCEEDED'
  )
    return hold;
  const next = {
    ...hold,
    status: 'COMMITTED',
    version: hold.version + 1,
  };
  await replaceMedicationHold(connection, { id: hold.id }, next, { session });
  return next;
}
async function handleBillingMessage({ connection, message, now = new Date() }) {
  const type = message?.messageType;
  const supported = [
    'ChargePrepared',
    'ReserveSettlement',
    'SettlementDecision',
    'ChargePaid',
    'BillingStatusChanged',
  ];
  if (
    !supported.includes(type) ||
    !['billing', 'Billing'].includes(message.producer) ||
    message.messageKind !== (type === 'ReserveSettlement' ? 'COMMAND' : 'EVENT')
  )
    throw failure(400, 'INVALID_MESSAGE', 'Trusted Billing envelope required.');
  return consume(
    { connection, message, now, consumerName: 'pharmacy-billing' },
    async (session) => {
      const p = message.payload;
      if (
        await isForeignBillingEvent(
          connection,
          message,
          ['MED_HOLD', 'PHARMACY'],
          'medication_holds',
          session,
        )
      )
        return { ignored: true, reason: 'OTHER_SOURCE_OWNER' };
      const coll = connection.collection('medication_holds');
      const hold = await loadMedicationHold(
        connection,
        type === 'BillingStatusChanged'
          ? { chargeId: p.chargeId }
          : { id: p.sourceId },
        { session },
      );
      if (type === 'BillingStatusChanged') {
        if (!hold)
          throw failure(
            503,
            'SOURCE_PENDING_SYNC',
            'Charge is not synchronized.',
          );
        integer(p.version, 'version');
        if (p.sourceId && p.sourceId !== hold.id)
          throw failure(409, 'SOURCE_MISMATCH', 'Billing source differs.');
        // The versioned Billing receipt is committed by consume in the same transaction.
        return { state: 'APPLIED' };
      }
      const rejectReserve = async (reasonCode) => {
        uuid(p.sourceId, 'sourceId');
        uuid(p.settlementId, 'settlementId');
        integer(p.sourceRevision, 'sourceRevision');
        const responseMessageId = await outbox(connection, session, {
          type: 'SettlementReserved',
          aggregateId: p.sourceId,
          version: hold?.version || 1,
          requestId: message.requestId,
          correlationId: message.correlationId,
          now,
          payload: {
            settlementId: p.settlementId,
            sourceId: p.sourceId,
            sourceRevision: p.sourceRevision,
            state: 'REJECTED',
            reasonCode,
          },
        });
        return { state: 'REJECTED', responseMessageId };
      };
      if (
        type === 'ChargePrepared' &&
        hold &&
        ['MED_HOLD', 'PHARMACY'].includes(p.sourceType) &&
        Number.isSafeInteger(p.sourceRevision) &&
        p.sourceRevision > 0 &&
        p.sourceRevision < hold.attemptNo &&
        (hold.attemptHistory || []).some(
          (entry) =>
            entry.attemptNo === p.sourceRevision &&
            ['RELEASED', 'EXPIRED'].includes(entry.status),
        )
      ) {
        const original = await connection.collection('outbox').findOne(
          {
            message_type: 'RequestCharge',
            aggregate_id: hold.id,
            'payload.sourceRevision': p.sourceRevision,
            'payload.requestId': p.requestId,
          },
          { session },
        );
        if (original && ['CREATED', 'REJECTED'].includes(p.state)) {
          if (p.state === 'CREATED') uuid(p.chargeId, 'chargeId');
          return { state: 'IGNORED', reason: 'RETIRED_HOLD_ATTEMPT' };
        }
      }
      if (
        type === 'ReserveSettlement' &&
        ['MED_HOLD', 'PHARMACY'].includes(p.sourceType) &&
        (!hold || p.sourceRevision !== hold.attemptNo)
      )
        return rejectReserve('SOURCE_MISMATCH');
      if (
        !hold ||
        (type === 'SettlementDecision'
          ? p.sourceType && !['MED_HOLD', 'PHARMACY'].includes(p.sourceType)
          : !['MED_HOLD', 'PHARMACY'].includes(p.sourceType)) ||
        p.sourceRevision !== hold.attemptNo
      )
        throw failure(
          409,
          'SOURCE_MISMATCH',
          'Billing source/attempt differs.',
        );
      if (type === 'ChargePrepared') {
        if (!['CREATED', 'REJECTED'].includes(p.state))
          throw failure(400, 'INVALID_MESSAGE', 'Invalid preparation state.');
        if (p.requestId && p.requestId !== hold.requestId)
          throw failure(409, 'SOURCE_MISMATCH', 'Charge request differs.');
        if (p.state === 'CREATED') uuid(p.chargeId, 'chargeId');
        if (hold.chargeId && hold.chargeId !== p.chargeId)
          throw failure(
            409,
            'MESSAGE_CONFLICT',
            'Charge identity is immutable.',
          );
        if (hold.chargeSync === 'REJECTED' && p.state === 'CREATED')
          throw failure(
            409,
            'MESSAGE_CONFLICT',
            'Rejected charge cannot be resurrected.',
          );
        await coll.updateOne(
          { id: hold.id },
          {
            $set: {
              chargeId: p.state === 'CREATED' ? p.chargeId : null,
            },
          },
          { session },
        );
        if (
          ['RELEASED', 'EXPIRED'].includes(hold.status) &&
          p.state === 'CREATED'
        ) {
          await outbox(connection, session, {
            type: 'MedicationHoldChanged',
            aggregateId: hold.id,
            version: hold.version,
            now,
            payload: {
              holdId: hold.id,
              attemptNo: hold.attemptNo,
              chargeId: p.chargeId,
              changeType: hold.status,
              cancellationId: hold.cancellationId,
              version: hold.version,
            },
          });
        }
        return { state: hold.status };
      }
      uuid(p.settlementId, 'settlementId');
      if (type === 'ReserveSettlement') {
        const failed = await connection
          .collection('settlement_decisions')
          .findOne(
            {
              sourceId: hold.id,
              sourceRevision: hold.attemptNo,
              settlementId: p.settlementId,
              state: 'FAILED',
            },
            { session },
          );
        if (failed || hold.status !== 'HELD' || new Date(hold.expiresAt) <= now)
          if (!(
            hold.status === 'SETTLEMENT_LOCKED' &&
            hold.settlementId === p.settlementId &&
            !failed
          ))
            return rejectReserve('STATE_CONFLICT');
        if (!hold.chargeId && hold.chargeSync !== 'REJECTED')
          throw failure(
            503,
            'CHARGE_PENDING_SYNC',
            'ChargePrepared has not reached this owner yet.',
          );
        const replayingLock =
          hold.status === 'SETTLEMENT_LOCKED' &&
          hold.settlementId === p.settlementId;
        if (
          p.chargeId !== hold.chargeId ||
          p.amountHash !== hold.snapshotHash ||
          !Number.isInteger(p.attemptVersion) ||
          p.attemptVersion !==
            (replayingLock
              ? hold.reserveAttemptVersion
              : (hold.reserveAttemptVersion || 0) + 1)
        )
          return rejectReserve('SETTLEMENT_MISMATCH');
        if (replayingLock) {
          await connection
            .collection('outbox')
            .updateOne(
              { message_id: hold.reserveResponseId },
              { $set: { published_at: null } },
              { session },
            );
          return {
            state: 'ACCEPTED',
            fence: hold.fence,
            responseMessageId: hold.reserveResponseId,
          };
        }
        const fence = (hold.fenceCounter || 0) + 1;
        const locked = {
          ...hold,
          status: 'SETTLEMENT_LOCKED',
          settlementId: p.settlementId,
          settlementState: 'PENDING',
          settlementVersion: 0,
          paidEvidence: null,
          reserveAttemptVersion: p.attemptVersion,
          fence,
          fenceCounter: fence,
          version: hold.version + 1,
        };
        locked.reserveResponseId = await outbox(connection, session, {
          type: 'SettlementReserved',
          aggregateId: hold.id,
          version: locked.version,
          requestId: message.requestId,
          correlationId: message.correlationId,
          now,
          payload: {
            sourceType: 'MED_HOLD',
            sourceId: hold.id,
            sourceRevision: hold.attemptNo,
            settlementId: p.settlementId,
            chargeId: hold.chargeId,
            state: 'ACCEPTED',
            fence,
            lockedAt: now.toISOString(),
            amountHash: hold.snapshotHash,
          },
        });
        await replaceMedicationHold(connection, { id: hold.id }, locked, {
          session,
        });
        return {
          state: 'ACCEPTED',
          fence,
          responseMessageId: locked.reserveResponseId,
        };
      }
      // A terminal failure can arrive before the reserve command. Persist it without
      // changing another settlement's lock; late reserves consult this tombstone.
      if (
        type === 'SettlementDecision' &&
        p.state === 'FAILED' &&
        (hold.status !== 'SETTLEMENT_LOCKED' ||
          p.settlementId !== hold.settlementId)
      ) {
        integer(p.decisionVersion, 'decisionVersion');
        const decisions = connection.collection('settlement_decisions');
        const identity = {
          sourceId: hold.id,
          sourceRevision: hold.attemptNo,
          settlementId: p.settlementId,
          decisionVersion: p.decisionVersion,
        };
        const previous = await decisions.findOne(identity, { session });
        if (previous && previous.payloadHash !== hash(p))
          throw failure(
            409,
            'MESSAGE_CONFLICT',
            'Same decision version differs.',
          );
        const terminal = await decisions.findOne(
          {
            sourceId: hold.id,
            sourceRevision: hold.attemptNo,
            settlementId: p.settlementId,
            state: 'SUCCEEDED',
          },
          { session },
        );
        if (
          terminal ||
          (p.settlementId === hold.settlementId &&
            ['COMMITTED', 'DISPENSED'].includes(hold.status))
        )
          throw failure(
            409,
            'MESSAGE_CONFLICT',
            'Terminal settlement decision cannot change.',
          );
        if (!previous)
          await decisions.insertOne(
            {
              ...identity,
              state: 'FAILED',
              payloadHash: hash(p),
              createdAt: now,
            },
            { session },
          );
        return { state: hold.status };
      }
      const unknownWithoutFence =
        type === 'SettlementDecision' &&
        p.state === 'UNKNOWN' &&
        p.fence == null;
      if (
        (!unknownWithoutFence &&
          (!Number.isInteger(p.fence) ||
            p.fence < 1 ||
            p.fence !== hold.fence)) ||
        p.settlementId !== hold.settlementId ||
        (type === 'ChargePaid'
          ? p.chargeId !== hold.chargeId
          : p.chargeId && p.chargeId !== hold.chargeId)
      )
        throw failure(
          409,
          'SETTLEMENT_MISMATCH',
          'Evidence does not match the locked attempt.',
        );
      if (type === 'ChargePaid') {
        if (p.amountVnd !== hold.amountVnd)
          throw failure(409, 'AMOUNT_MISMATCH', 'Payment amount differs.');
        if (
          typeof p.transactionId !== 'string' ||
          !p.transactionId.trim() ||
          p.transactionId.length > 100
        )
          throw failure(
            400,
            'INVALID_MESSAGE',
            'transactionId must be nonempty text up to 100 characters.',
          );
        if (!Number.isFinite(Date.parse(p.paidAt)))
          throw failure(400, 'INVALID_MESSAGE', 'Invalid paidAt.');
        const evidence = {
          chargeId: p.chargeId,
          settlementId: p.settlementId,
          fence: p.fence,
          sourceRevision: p.sourceRevision,
          transactionId: p.transactionId,
          amountVnd: p.amountVnd,
          paidAt: p.paidAt,
        };
        if (hold.paidEvidence && hash(hold.paidEvidence) !== hash(evidence))
          throw failure(409, 'MESSAGE_CONFLICT', 'Payment evidence changed.');
        if (['COMMITTED', 'DISPENSED'].includes(hold.status))
          return { state: hold.status };
        if (
          hold.status !== 'SETTLEMENT_LOCKED' ||
          hold.settlementState === 'FAILED'
        )
          throw failure(
            409,
            'STATE_CONFLICT',
            'A terminal source cannot receive payment.',
          );
        const changed = { ...hold, paidEvidence: evidence };
        await replaceMedicationHold(connection, { id: hold.id }, changed, {
          session,
        });
        return {
          state: (await maybeCommit(connection, session, changed)).status,
        };
      }
      integer(p.decisionVersion, 'decisionVersion');
      if (!['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(p.state))
        throw failure(400, 'INVALID_MESSAGE', 'Unknown settlement decision.');
      if (p.state === 'FAILED' && hold.paidEvidence)
        throw failure(
          409,
          'MESSAGE_CONFLICT',
          'Verified payment evidence cannot be discarded by FAILED.',
        );
      const decisions = connection.collection('settlement_decisions');
      const query = {
        sourceId: hold.id,
        sourceRevision: hold.attemptNo,
        settlementId: p.settlementId,
        decisionVersion: p.decisionVersion,
      };
      const current = await decisions.findOne(query, { session });
      const fingerprint = hash(p);
      if (current && current.payloadHash !== fingerprint)
        throw failure(
          409,
          'MESSAGE_CONFLICT',
          'Same decision version differs.',
        );
      if (!current)
        await decisions.insertOne(
          {
            ...query,
            state: p.state,
            payloadHash: fingerprint,
            fence: p.fence,
            paymentId: p.paymentId || null,
            createdAt: now,
          },
          { session },
        );
      if (p.decisionVersion <= (hold.settlementVersion || 0))
        return { state: hold.status };
      if (
        ['SUCCEEDED', 'FAILED'].includes(hold.settlementState) &&
        hold.settlementState !== p.state
      )
        throw failure(
          409,
          'MESSAGE_CONFLICT',
          'Terminal settlement decision cannot change.',
        );
      if (['COMMITTED', 'DISPENSED'].includes(hold.status))
        return { state: hold.status };
      if (hold.status !== 'SETTLEMENT_LOCKED')
        throw failure(
          409,
          'STATE_CONFLICT',
          'Settlement source is not locked.',
        );
      if (p.state === 'SUCCEEDED') uuid(p.paymentId, 'paymentId');
      let changed = {
        ...hold,
        settlementState: p.state,
        settlementVersion: p.decisionVersion,
      };
      if (p.state === 'FAILED') {
        changed = {
          ...changed,
          status: 'HELD',
          version: hold.version + 1,
          paidEvidence: null,
        };
        await replaceMedicationHold(connection, { id: hold.id }, changed, {
          session,
        });
        if (new Date(changed.expiresAt) <= now) {
          await returnReservation({
            connection,
            session,
            hold: changed,
            state: 'EXPIRED',
            now,
          });
          return { state: 'EXPIRED' };
        }
        return { state: 'HELD' };
      }
      await replaceMedicationHold(connection, { id: hold.id }, changed, {
        session,
      });
      return {
        state: (await maybeCommit(connection, session, changed)).status,
      };
    },
  );
}
async function reconcileMedicationHold(args) {
  const { connection, holdId, expectedAttemptNo, now = new Date() } = args;
  uuid(holdId);
  integer(expectedAttemptNo, 'expectedAttemptNo');
  return mutate(
    { ...args, now, route: 'PH-007:' + holdId, input: { expectedAttemptNo } },
    async (session) => {
      const hold = await loadMedicationHold(
        connection,
        { id: holdId },
        { session },
      );
      if (!hold) throw failure(404, 'NOT_FOUND', 'Hold not found.');
      if (hold.attemptNo !== expectedAttemptNo)
        throw failure(409, 'STATE_CONFLICT', 'Attempt changed.');
      if (['RELEASED', 'EXPIRED'].includes(hold.status))
        throw failure(409, 'HOLD_EXPIRED', 'Hold is no longer active.');
      const updated = await maybeCommit(connection, session, hold);
      return pending(updated);
    },
  );
}
async function queryUnresolvedSettlements({
  connection,
  now = new Date(),
  intervalMs = 30000,
}) {
  const { withMongoTransaction } = require('../../../../mongo/transaction');
  const rows = await connection
    .collection('medication_holds')
    .aggregate([
      { $match: { status: 'SETTLEMENT_LOCKED' } },
      {
        $lookup: {
          from: 'outbox',
          let: { source: '$id', settlement: '$settlementId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$aggregate_id', '$$source'] },
                    { $eq: ['$message_type', 'QuerySettlement'] },
                    { $eq: ['$payload.settlementId', '$$settlement'] },
                  ],
                },
              },
            },
            { $sort: { occurred_at: -1 } },
            { $limit: 1 },
          ],
          as: 'queries',
        },
      },
      {
        $match: {
          $or: [
            { 'queries.0': { $exists: false } },
            { 'queries.0.occurred_at': { $lte: new Date(+now - intervalMs) } },
          ],
        },
      },
      { $sort: { 'queries.0.occurred_at': 1, id: 1 } },
      { $limit: 100 },
      { $project: { id: 1 } },
    ])
    .toArray();
  let count = 0;
  for (const row of rows) {
    const changed = await withMongoTransaction(connection, async (session) => {
      const hold = await loadMedicationHold(
        connection,
        {
          id: row.id,
          status: 'SETTLEMENT_LOCKED',
        },
        { session },
      );
      if (!hold) return false;
      const lastQuery = await connection.collection('outbox').findOne(
        {
          aggregate_id: hold.id,
          message_type: 'QuerySettlement',
          'payload.settlementId': hold.settlementId,
        },
        { session, sort: { occurred_at: -1 } },
      );
      if (lastQuery && +new Date(lastQuery.occurred_at) + intervalMs > +now)
        return false;
      const requestId = randomUUID();
      await outbox(connection, session, {
        type: 'QuerySettlement',
        kind: 'COMMAND',
        aggregateId: hold.id,
        version: hold.version,
        requestId,
        now,
        payload: {
          requestId,
          settlementId: hold.settlementId,
          sourceType: 'MED_HOLD',
          sourceId: hold.id,
          sourceRevision: hold.attemptNo,
        },
      });
      await connection
        .collection('medication_holds')
        .updateOne({ id: hold.id }, { $inc: { version: 1 } }, { session });
      return true;
    });
    if (changed) count++;
  }
  return count;
}
module.exports = {
  handleBillingMessage,
  reconcileMedicationHold,
  queryUnresolvedSettlements,
};
