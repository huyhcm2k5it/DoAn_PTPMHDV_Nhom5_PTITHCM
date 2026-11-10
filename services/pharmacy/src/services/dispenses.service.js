const { randomUUID } = require('node:crypto');
const { uuid, integer, mutate, outbox, failure } = require('./common');
async function dispenseMedication(args) {
  const {
    connection,
    holdId,
    expectedVersion,
    principalId,
    now = new Date(),
  } = args;
  uuid(holdId);
  integer(expectedVersion, 'expectedVersion');
  return mutate(
    { ...args, now, route: 'PH-008:' + holdId, input: { expectedVersion } },
    async (session) => {
      const hold = await connection
        .collection('medication_holds')
        .findOne({ id: holdId }, { session });
      if (!hold) throw failure(404, 'NOT_FOUND', 'Hold not found.');
      if (hold.status === 'DISPENSED')
        throw failure(
          409,
          'ALREADY_DISPENSED',
          'Prescription has already been dispensed.',
        );
      if (
        hold.status !== 'COMMITTED' ||
        !hold.paidEvidence ||
        hold.settlementState !== 'SUCCEEDED'
      )
        throw failure(
          409,
          'SETTLEMENT_NOT_CONFIRMED',
          'A confirmed local settlement is required.',
        );
      if (hold.version !== expectedVersion)
        throw failure(409, 'STATE_CONFLICT', 'Hold version changed.');
      for (const item of hold.itemsSnapshot) {
        const changed = await connection.collection('inventory').updateOne(
          {
            medicineId: item.medicineId,
            onHand: { $gte: item.quantity },
            reserved: { $gte: item.quantity },
          },
          {
            $inc: {
              onHand: -item.quantity,
              reserved: -item.quantity,
              version: 1,
            },
          },
          { session },
        );
        if (!changed.modifiedCount)
          throw failure(
            500,
            'STOCK_INVARIANT_BROKEN',
            'Committed reservation is missing.',
          );
        await connection.collection('stock_audit').insertOne(
          {
            id: randomUUID(),
            medicineId: item.medicineId,
            kind: 'DISPENSE',
            quantity: -item.quantity,
            holdId,
            attemptNo: hold.attemptNo,
            actorUserId: principalId,
            at: now,
          },
          { session },
        );
      }
      const dispenseId = randomUUID();
      await connection.collection('dispenses').insertOne(
        {
          id: dispenseId,
          holdId,
          prescriptionId: hold.prescriptionId,
          revision: hold.revision,
          actorUserId: principalId,
          itemsSnapshot: hold.itemsSnapshot,
          dispensedAt: now,
          attemptNo: hold.attemptNo,
        },
        { session },
      );
      await connection.collection('medication_holds').updateOne(
        { id: holdId, version: expectedVersion },
        {
          $set: { status: 'DISPENSED', dispensedAt: now },
          $inc: { version: 1 },
        },
        { session },
      );
      await outbox(connection, session, {
        type: 'MedicationDispensed',
        aggregateId: holdId,
        version: hold.version + 1,
        now,
        payload: {
          prescriptionId: hold.prescriptionId,
          revision: hold.revision,
          holdId,
          attemptNo: hold.attemptNo,
          recipientUserId: hold.recipientUserId,
          dispensedAt: now.toISOString(),
        },
      });
      return { dispenseId, holdId, state: 'DISPENSED' };
    },
  );
}
module.exports = { dispenseMedication };
