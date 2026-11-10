const { randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction');
const { resolveCatalogPrice } = require('../../../../mongo/catalog-projection');
const {
  uuid,
  integer,
  mutate,
  outbox,
  pending,
  hash,
  failure,
} = require('./common');
async function createMedicationHold(args) {
  const {
    connection,
    prescriptionId,
    prescriptionRevision,
    principalId,
    now = new Date(),
  } = args;
  uuid(prescriptionId);
  integer(prescriptionRevision, 'prescriptionRevision');
  return mutate(
    {
      ...args,
      now,
      route: 'PH-005:' + prescriptionId,
      input: { prescriptionRevision },
    },
    async (session, user) => {
      const latest = await connection
        .collection('prescription_projection')
        .find({ prescriptionId }, { session })
        .sort({ revision: -1 })
        .limit(1)
        .next();
      if (!latest)
        throw failure(
          503,
          'SERVICE_UNAVAILABLE',
          'FINAL prescription not projected.',
        );
      if (latest.revision !== prescriptionRevision)
        throw failure(
          409,
          'PRESCRIPTION_REVISION_CONFLICT',
          'Prescription revision changed.',
        );
      const holdColl = connection.collection('medication_holds');
      const old = await holdColl.findOne(
        { prescriptionId, revision: prescriptionRevision },
        { session },
      );
      if (old && !['RELEASED', 'EXPIRED'].includes(old.status))
        throw failure(
          409,
          'STATE_CONFLICT',
          'An active or completed hold exists.',
        );
      const access = await connection
        .collection('patient_access_projection')
        .findOne(
          {
            patientId: latest.patientId,
            active: true,
          },
          { session },
        );
      if (!access)
        throw failure(
          503,
          'SERVICE_UNAVAILABLE',
          'Patient ownership projection is unavailable.',
        );
      const items = [];
      let amountVnd = 0;
      for (const line of latest.itemsSnapshot) {
        const medicine = await connection
          .collection('catalog_projection')
          .findOne(
            {
              entityType: 'MEDICINE',
              active: true,
              'fullSnapshot.code': line.medicineCode,
            },
            { session },
          );
        if (!medicine || medicine.fullSnapshot.status !== 'ACTIVE')
          throw failure(
            503,
            'SERVICE_UNAVAILABLE',
            'Medicine projection is unavailable.',
          );
        const price = await resolveCatalogPrice(connection, medicine.entityId, {
          now,
          session,
        });
        if (!price)
          throw failure(
            503,
            'SERVICE_UNAVAILABLE',
            'Current price feed is unavailable.',
          );
        const changed = await connection.collection('inventory').updateOne(
          {
            medicineId: medicine.entityId,
            $expr: {
              $gte: [{ $subtract: ['$onHand', '$reserved'] }, line.quantity],
            },
          },
          { $inc: { reserved: line.quantity, version: 1 } },
          { session },
        );
        if (!changed.modifiedCount)
          throw Object.assign(
            failure(
              409,
              'INSUFFICIENT_STOCK',
              'Full prescription cannot be reserved.',
            ),
            {
              details: {
                shortages: [
                  { medicineId: medicine.entityId, requested: line.quantity },
                ],
              },
            },
          );
        amountVnd += price.amountVnd * line.quantity;
        if (!Number.isSafeInteger(amountVnd))
          throw failure(
            400,
            'VALIDATION_ERROR',
            'Prescription amount exceeds safe integer.',
          );
        items.push({
          ...line,
          medicineId: medicine.entityId,
          unitAmountVnd: price.amountVnd,
          priceVersionId: price.priceVersionId,
          priceVersion: price.priceVersion,
        });
      }
      const requestId = randomUUID(),
        id = old?.id || randomUUID();
      const attemptNo = (old?.attemptNo || 0) + 1;
      const value = {
        id,
        prescriptionId,
        revision: prescriptionRevision,
        patientId: latest.patientId,
        recipientUserId: access.ownerUserId,
        attemptNo,
        status: 'HELD',
        version: (old?.version || 0) + 1,
        itemsSnapshot: items,
        amountVnd,
        currency: 'VND',
        snapshotHash: hash(items),
        requestId,
        expiresAt: new Date(now.getTime() + 900000),
        createdAt: old?.createdAt || now,
        updatedAt: now,
        chargeSync: 'PENDING',
        chargeId: null,
        settlementId: null,
        settlementState: 'NONE',
        fence: null,
        fenceCounter: old?.fenceCounter || 0,
        attemptHistory: old
          ? [
              ...(old.attemptHistory || []),
              {
                attemptNo: old.attemptNo,
                status: old.status,
                chargeId: old.chargeId,
                settlementId: old.settlementId,
                fence: old.fence,
                expiresAt: old.expiresAt,
              },
            ]
          : [],
      };
      await holdColl.replaceOne(
        { prescriptionId, revision: prescriptionRevision },
        value,
        {
          session,
          upsert: true,
        },
      );
      await outbox(connection, session, {
        type: 'RequestCharge',
        kind: 'COMMAND',
        aggregateId: id,
        version: value.version,
        requestId,
        now,
        payload: {
          requestId,
          sourceType: 'MED_HOLD',
          sourceId: id,
          sourceRevision: attemptNo,
          actorId: principalId,
          policyVersion: user.policyVersion,
          authorizedAt: now.toISOString(),
          patientId: latest.patientId,
          recipientUserId: access.ownerUserId,
          linesSnapshot: items,
          amountVnd,
          currency: 'VND',
          snapshotHash: value.snapshotHash,
          pricingAt: now.toISOString(),
          expiresAt: value.expiresAt.toISOString(),
        },
      });
      return pending(value);
    },
  );
}
async function returnReservation({ connection, session, hold, state, now }) {
  for (const item of hold.itemsSnapshot) {
    const changed = await connection.collection('inventory').updateOne(
      {
        medicineId: item.medicineId,
        reserved: { $gte: item.quantity },
      },
      { $inc: { reserved: -item.quantity, version: 1 } },
      { session },
    );
    if (!changed.modifiedCount)
      throw failure(
        500,
        'STOCK_INVARIANT_BROKEN',
        'Reserved stock cannot be returned.',
      );
  }
  const cancellationId = randomUUID();
  await connection.collection('medication_holds').updateOne(
    { id: hold.id, version: hold.version, status: 'HELD' },
    {
      $set: { status: state, cancellationId, updatedAt: now },
      $inc: { version: 1 },
    },
    { session },
  );
  await outbox(connection, session, {
    type: 'MedicationHoldChanged',
    aggregateId: hold.id,
    version: hold.version + 1,
    now,
    payload: {
      holdId: hold.id,
      attemptNo: hold.attemptNo,
      chargeId: hold.chargeId || null,
      changeType: state,
      cancellationId,
      version: hold.version + 1,
    },
  });
}
async function releaseMedicationHold(args) {
  const { connection, holdId, expectedVersion, now = new Date() } = args;
  uuid(holdId);
  integer(expectedVersion, 'expectedVersion');
  return mutate(
    { ...args, now, route: 'PH-006:' + holdId, input: { expectedVersion } },
    async (session) => {
      const hold = await connection
        .collection('medication_holds')
        .findOne({ id: holdId }, { session });
      if (!hold) throw failure(404, 'NOT_FOUND', 'Hold not found.');
      if (hold.status !== 'HELD' || hold.version !== expectedVersion)
        throw failure(409, 'STATE_CONFLICT', 'Hold cannot be released.');
      await returnReservation({
        connection,
        session,
        hold,
        state: 'RELEASED',
        now,
      });
      return { holdId, state: 'RELEASED' };
    },
  );
}
async function expireMedicationHolds({
  connection,
  now = new Date(),
  batchSize = 100,
}) {
  const candidates = await connection
    .collection('medication_holds')
    .find({
      status: 'HELD',
      expiresAt: { $lte: now },
    })
    .sort({ expiresAt: 1 })
    .limit(batchSize)
    .toArray();
  let expired = 0;
  for (const candidate of candidates) {
    const changed = await withMongoTransaction(connection, async (session) => {
      const hold = await connection.collection('medication_holds').findOne(
        {
          id: candidate.id,
          status: 'HELD',
          expiresAt: { $lte: now },
        },
        { session },
      );
      if (!hold) return false;
      await returnReservation({
        connection,
        session,
        hold,
        state: 'EXPIRED',
        now,
      });
      return true;
    });
    if (changed) expired++;
  }
  return expired;
}
module.exports = {
  createMedicationHold,
  releaseMedicationHold,
  expireMedicationHolds,
  returnReservation,
};
