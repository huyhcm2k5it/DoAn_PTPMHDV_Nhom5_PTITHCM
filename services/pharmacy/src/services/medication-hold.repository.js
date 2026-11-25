const { hash } = require('../../../../mongo/catalog-projection');

const medicationHoldFields = [
  'id',
  'prescriptionId',
  'revision',
  'attemptNo',
  'status',
  'itemsSnapshot',
  'expiresAt',
  'chargeId',
  'version',
  'attemptHistory',
  'patientId',
  'settlementId',
  'settlementState',
  'settlementVersion',
];

function medicationHoldDocument(value) {
  return Object.fromEntries(
    medicationHoldFields
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
}

async function replaceMedicationHold(connection, filter, value, options) {
  return connection
    .collection('medication_holds')
    .replaceOne(filter, medicationHoldDocument(value), options);
}

// These are received Billing messages and original owner commands, not invented
// settlement records. Retain them for the complete source/settlement lifecycle.
async function hydrateMedicationHold(connection, row, { session } = {}) {
  if (!row) return null;
  const source = await connection.collection('outbox').findOne(
    {
      aggregate_id: row.id,
      message_type: 'RequestCharge',
      'payload.sourceRevision': row.attemptNo,
    },
    { session },
  );
  const deliveries = await connection
    .collection('inbox')
    .find(
      {
        consumer_name: 'pharmacy-billing',
        $or: [
          { 'payload.sourceId': row.id },
          ...(row.chargeId ? [{ 'payload.chargeId': row.chargeId }] : []),
        ],
      },
      { session },
    )
    .toArray();
  const current = deliveries.filter(
    (item) => item.payload.sourceRevision === row.attemptNo,
  );
  const prepared = current.find(
    (item) => item.message_type === 'ChargePrepared',
  );
  const reserves = deliveries.filter(
    (item) =>
      item.message_type === 'ReserveSettlement' &&
      item.result?.state === 'ACCEPTED',
  );
  const reserve = current.find(
    (item) =>
      item.message_type === 'ReserveSettlement' &&
      item.result?.state === 'ACCEPTED' &&
      item.payload.settlementId === row.settlementId,
  );
  const paid = current.find(
    (item) =>
      item.message_type === 'ChargePaid' &&
      item.payload.settlementId === row.settlementId &&
      item.payload.chargeId === row.chargeId,
  );
  const statuses = deliveries
    .filter(
      (item) =>
        item.message_type === 'BillingStatusChanged' &&
        item.payload.chargeId === row.chargeId,
    )
    .sort((a, b) => b.payload.version - a.payload.version);
  const cancellation = await connection.collection('outbox').findOne(
    {
      aggregate_id: row.id,
      message_type: 'MedicationHoldChanged',
      'payload.attemptNo': row.attemptNo,
    },
    { session, sort: { aggregate_version: -1 } },
  );
  const p = paid?.payload;
  const evidence = p
    ? Object.fromEntries(
        [
          'chargeId',
          'settlementId',
          'fence',
          'sourceRevision',
          'transactionId',
          'amountVnd',
          'paidAt',
        ].map((key) => [key, p[key]]),
      )
    : row.paidEvidence;
  return {
    ...row,
    requestId: source?.payload.requestId ?? row.requestId,
    recipientUserId: source?.payload.recipientUserId ?? row.recipientUserId,
    amountVnd: source?.payload.amountVnd ?? row.amountVnd,
    snapshotHash:
      source?.payload.snapshotHash ??
      row.snapshotHash ??
      hash(row.itemsSnapshot),
    chargeSync:
      prepared?.payload.state ??
      row.chargeSync ??
      (row.chargeId ? 'CREATED' : 'PENDING'),
    fence: reserve?.result.fence ?? row.fence,
    fenceCounter: Math.max(
      row.fenceCounter || 0,
      ...reserves.map((item) => item.result.fence || 0),
    ),
    reserveAttemptVersion:
      reserve?.payload.attemptVersion ?? row.reserveAttemptVersion,
    reserveResponseId:
      reserve?.result.responseMessageId ?? row.reserveResponseId,
    paidEvidence: evidence,
    billingStatusVersion:
      statuses[0]?.payload.version ?? row.billingStatusVersion ?? 0,
    refundStatus: statuses[0]?.payload.refundStatus ?? row.refundStatus,
    cancellationId: cancellation?.payload.cancellationId ?? row.cancellationId,
  };
}

async function loadMedicationHold(connection, filter, options = {}) {
  const row = await connection
    .collection('medication_holds')
    .findOne(filter, options);
  return hydrateMedicationHold(connection, row, options);
}

module.exports = {
  medicationHoldFields,
  medicationHoldDocument,
  replaceMedicationHold,
  hydrateMedicationHold,
  loadMedicationHold,
};
