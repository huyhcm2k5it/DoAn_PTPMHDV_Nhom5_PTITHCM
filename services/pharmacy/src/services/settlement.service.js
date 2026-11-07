const { randomUUID } = require('node:crypto');
const { consume, mutate, uuid, integer, failure, hash, outbox, pending } = require('./common');
const { returnReservation } = require('./medication-holds.service');

async function maybeCommit(connection, session, hold, now) {
  if (
    hold.status !== 'SETTLEMENT_LOCKED' ||
    !hold.paidEvidence ||
    hold.settlementState !== 'SUCCEEDED'
  )
    return hold;
  const next = {
    ...hold,
    status: 'COMMITTED',
    committedAt: now,
    updatedAt: now,
    version: hold.version + 1,
  };
  await connection.collection('medication_holds').replaceOne({ id: hold.id }, next, { session });
  return next;
}
async function handleBillingMessage({ connection, message, now = new Date() }) {
  const type = message?.messageType;
  const supported = ['ChargePrepared', 'ReserveSettlement', 'SettlementDecision', 'ChargePaid'];
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
      const coll = connection.collection('medication_holds');
      const hold = await coll.findOne({ id: p.sourceId }, { session });
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
        type === 'ReserveSettlement' &&
        p.sourceType === 'PHARMACY' &&
        (!hold || p.sourceRevision !== hold.attemptNo)
      )
        return rejectReserve('SOURCE_MISMATCH');
      if (
        !hold ||
        (type === 'SettlementDecision'
          ? p.sourceType && p.sourceType !== 'PHARMACY'
          : p.sourceType !== 'PHARMACY') ||
        p.sourceRevision !== hold.attemptNo
      )
        throw failure(409, 'SOURCE_MISMATCH', 'Billing source/attempt differs.');
      if (type === 'ChargePrepared') {
        if (!['CREATED', 'REJECTED'].includes(p.state))
          throw failure(400, 'INVALID_MESSAGE', 'Invalid preparation state.');
        if (p.requestId && p.requestId !== hold.requestId)
          throw failure(409, 'SOURCE_MISMATCH', 'Charge request differs.');
        if (p.state === 'CREATED') uuid(p.chargeId, 'chargeId');
        if (hold.chargeId && hold.chargeId !== p.chargeId)
          throw failure(409, 'MESSAGE_CONFLICT', 'Charge identity is immutable.');
        if (hold.chargeSync === 'REJECTED' && p.state === 'CREATED')
          throw failure(409, 'MESSAGE_CONFLICT', 'Rejected charge cannot be resurrected.');
        await coll.updateOne(
          { id: hold.id },
          {
            $set: {
              chargeSync: p.state,
              chargeId: p.state === 'CREATED' ? p.chargeId : null,
              updatedAt: now,
            },
          },
          { session },
        );
        if (['RELEASED', 'EXPIRED'].includes(hold.status) && p.state === 'CREATED') {
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
        const failed = await connection.collection('settlement_decisions').findOne(
          {
            sourceId: hold.id,
            sourceRevision: hold.attemptNo,
            settlementId: p.settlementId,
            state: 'FAILED',
          },
          { session },
        );
        if (failed || hold.status !== 'HELD' || new Date(hold.expiresAt) <= now)
          if (
            !(
              hold.status === 'SETTLEMENT_LOCKED' &&
              hold.settlementId === p.settlementId &&
              !failed
            )
          )
            return rejectReserve('STATE_CONFLICT');
        if (!hold.chargeId && hold.chargeSync !== 'REJECTED')
          throw failure(
            503,
            'CHARGE_PENDING_SYNC',
            'ChargePrepared has not reached this owner yet.',
          );
        const replayingLock =
          hold.status === 'SETTLEMENT_LOCKED' && hold.settlementId === p.settlementId;
        if (
          p.chargeId !== hold.chargeId ||
          p.amountHash !== hold.snapshotHash ||
          !Number.isInteger(p.attemptVersion) ||
          p.attemptVersion !== (replayingLock ? hold.reserveAttemptVersion : hold.version)
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
          updatedAt: now,
        };
        locked.reserveResponseId = await outbox(connection, session, {
          type: 'SettlementReserved',
          aggregateId: hold.id,
          version: locked.version,
          requestId: message.requestId,
          correlationId: message.correlationId,
          now,
          payload: {
            sourceType: 'PHARMACY',
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
        await coll.replaceOne({ id: hold.id }, locked, { session });
        return { state: 'ACCEPTED', fence, responseMessageId: locked.reserveResponseId };
      }
      // A terminal failure can arrive before the reserve command. Persist it without
      // changing another settlement's lock; late reserves consult this tombstone.
      if (
        type === 'SettlementDecision' &&
        p.state === 'FAILED' &&
        (hold.status !== 'SETTLEMENT_LOCKED' || p.settlementId !== hold.settlementId)
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
          throw failure(409, 'MESSAGE_CONFLICT', 'Same decision version differs.');
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
          (p.settlementId === hold.settlementId && ['COMMITTED', 'DISPENSED'].includes(hold.status))
        )
          throw failure(409, 'MESSAGE_CONFLICT', 'Terminal settlement decision cannot change.');
        if (!previous)
          await decisions.insertOne(
            { ...identity, state: 'FAILED', payloadHash: hash(p), createdAt: now },
            { session },
          );
        return { state: hold.status };
      }
      const unknownWithoutFence =
        type === 'SettlementDecision' && p.state === 'UNKNOWN' && p.fence == null;
      if (
        (!unknownWithoutFence &&
          (!Number.isInteger(p.fence) || p.fence < 1 || p.fence !== hold.fence)) ||
        p.settlementId !== hold.settlementId ||
        (type === 'ChargePaid'
          ? p.chargeId !== hold.chargeId
          : p.chargeId && p.chargeId !== hold.chargeId)
      )
        throw failure(409, 'SETTLEMENT_MISMATCH', 'Evidence does not match the locked attempt.');
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
        if (['COMMITTED', 'DISPENSED'].includes(hold.status)) return { state: hold.status };
        if (hold.status !== 'SETTLEMENT_LOCKED' || hold.settlementState === 'FAILED')
          throw failure(409, 'STATE_CONFLICT', 'A terminal source cannot receive payment.');
        const changed = { ...hold, paidEvidence: evidence, updatedAt: now };
        await coll.replaceOne({ id: hold.id }, changed, { session });
        return { state: (await maybeCommit(connection, session, changed, now)).status };
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
        throw failure(409, 'MESSAGE_CONFLICT', 'Same decision version differs.');
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
      if (p.decisionVersion <= (hold.settlementVersion || 0)) return { state: hold.status };
      if (
        ['SUCCEEDED', 'FAILED'].includes(hold.settlementState) &&
        hold.settlementState !== p.state
      )
        throw failure(409, 'MESSAGE_CONFLICT', 'Terminal settlement decision cannot change.');
      if (['COMMITTED', 'DISPENSED'].includes(hold.status)) return { state: hold.status };
      if (hold.status !== 'SETTLEMENT_LOCKED')
        throw failure(409, 'STATE_CONFLICT', 'Settlement source is not locked.');
      if (p.state === 'SUCCEEDED') uuid(p.paymentId, 'paymentId');
      let changed = {
        ...hold,
        settlementState: p.state,
        settlementVersion: p.decisionVersion,
        updatedAt: now,
      };
      if (p.state === 'FAILED') {
        changed = { ...changed, status: 'HELD', version: hold.version + 1, paidEvidence: null };
        await coll.replaceOne({ id: hold.id }, changed, { session });
        if (new Date(changed.expiresAt) <= now) {
          await returnReservation({ connection, session, hold: changed, state: 'EXPIRED', now });
          return { state: 'EXPIRED' };
        }
        return { state: 'HELD' };
      }
      await coll.replaceOne({ id: hold.id }, changed, { session });
      return { state: (await maybeCommit(connection, session, changed, now)).status };
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
      const hold = await connection
        .collection('medication_holds')
        .findOne({ id: holdId }, { session });
      if (!hold) throw failure(404, 'NOT_FOUND', 'Hold not found.');
      if (hold.attemptNo !== expectedAttemptNo)
        throw failure(409, 'STATE_CONFLICT', 'Attempt changed.');
      if (['RELEASED', 'EXPIRED'].includes(hold.status))
        throw failure(409, 'HOLD_EXPIRED', 'Hold is no longer active.');
      const updated = await maybeCommit(connection, session, hold, now);
      return pending(updated);
    },
  );
}
async function queryUnresolvedSettlements({ connection, now = new Date(), intervalMs = 30000 }) {
  const { withMongoTransaction } = require('../../../../mongo/transaction');
  const rows = await connection
    .collection('medication_holds')
    .find({
      status: 'SETTLEMENT_LOCKED',
      $or: [{ queryAfter: null }, { queryAfter: { $lte: now } }],
    })
    .limit(100)
    .toArray();
  let count = 0;
  for (const row of rows) {
    const changed = await withMongoTransaction(connection, async (session) => {
      const hold = await connection.collection('medication_holds').findOne(
        {
          id: row.id,
          status: 'SETTLEMENT_LOCKED',
          $or: [{ queryAfter: null }, { queryAfter: { $lte: now } }],
        },
        { session },
      );
      if (!hold) return false;
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
          sourceType: 'PHARMACY',
          sourceId: hold.id,
          sourceRevision: hold.attemptNo,
        },
      });
      await connection
        .collection('medication_holds')
        .updateOne(
          { id: hold.id },
          { $set: { queryAfter: new Date(now.getTime() + intervalMs) } },
          { session },
        );
      return true;
    });
    if (changed) count++;
  }
  return count;
}
module.exports = { handleBillingMessage, reconcileMedicationHold, queryUnresolvedSettlements };
