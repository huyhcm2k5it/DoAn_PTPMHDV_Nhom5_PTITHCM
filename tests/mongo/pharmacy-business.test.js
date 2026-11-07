const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mongoHarness } = require('./test-harness');
const { ensurePharmacyStorage } = require('../../services/pharmacy/src/dbs/indexes');
const { receiveStock } = require('../../services/pharmacy/src/services/stock.service');
const {
  applyPrescriptionFinalized,
} = require('../../services/pharmacy/src/services/prescription-projection.service');
const {
  createMedicationHold,
  releaseMedicationHold,
  expireMedicationHolds,
} = require('../../services/pharmacy/src/services/medication-holds.service');
const {
  handleBillingMessage,
  reconcileMedicationHold,
} = require('../../services/pharmacy/src/services/settlement.service');
const { dispenseMedication } = require('../../services/pharmacy/src/services/dispenses.service');
const h = mongoHarness(ensurePharmacyStorage);
const staff = '00000000-0000-4000-8000-000000000902';
const owner = '00000000-0000-4000-8000-000000000901';
const patient = '00000000-0000-4000-8000-000000000701';
const medicine = '00000000-0000-4000-8000-000000000301';
const rx = '00000000-0000-4000-8000-000000000501';
const now = new Date('2026-11-07T00:00:00Z');
const key = randomUUID;
const bad = (code) => (error) => error.code === code;
const ctx = () => ({ connection: h.connection, principalId: staff, now });
function finalized(id = rx, quantity = 1) {
  return {
    messageId: key(),
    messageKind: 'EVENT',
    messageType: 'PrescriptionFinalized',
    schemaVersion: 1,
    producer: 'clinical',
    aggregateId: id,
    aggregateVersion: 1,
    correlationId: 'pharmacy-test',
    occurredAt: now.toISOString(),
    payload: {
      prescriptionId: id,
      revision: 1,
      patientId: patient,
      visitId: key(),
      itemsSnapshot: [
        { medicineCode: 'MED-1', quantity, nameSnapshot: 'Medicine', doseText: '1/day' },
      ],
      finalizedAt: now.toISOString(),
    },
  };
}
async function project(message = finalized()) {
  await applyPrescriptionFinalized({ connection: h.connection, message, now });
  return message;
}
async function hold(id = rx, idempotencyKey = key()) {
  return createMedicationHold({
    ...ctx(),
    prescriptionId: id,
    prescriptionRevision: 1,
    idempotencyKey,
  });
}
async function row(id) {
  return h.connection.collection('medication_holds').findOne({ id });
}
async function billing(type, holdId, extra = {}) {
  const r = await row(holdId);
  return handleBillingMessage({
    connection: h.connection,
    now,
    message: {
      messageId: key(),
      messageKind: type === 'ReserveSettlement' ? 'COMMAND' : 'EVENT',
      messageType: type,
      producer: 'billing',
      schemaVersion: 1,
      correlationId: 'test',
      payload: {
        sourceType: 'PHARMACY',
        sourceId: holdId,
        sourceRevision: r.attemptNo,
        chargeId: r.chargeId,
        settlementId: r.settlementId,
        fence: r.fence,
        amountVnd: r.amountVnd,
        amountHash: r.snapshotHash,
        attemptVersion: r.version,
        ...extra,
      },
    },
  });
}
async function paid(holdId) {
  const chargeId = key(),
    settlementId = key();
  await billing('ChargePrepared', holdId, { chargeId, state: 'CREATED' });
  await billing('ReserveSettlement', holdId, { chargeId, settlementId });
  await billing('SettlementDecision', holdId, {
    state: 'SUCCEEDED',
    decisionVersion: 1,
    paymentId: key(),
  });
  await billing('ChargePaid', holdId, { transactionId: 'TXN-123', paidAt: now.toISOString() });
}
beforeEach(async () => {
  await h.connection.collection('user_access_projection').insertOne({
    userId: staff,
    actorType: 'STAFF',
    capabilities: ['PHARMACY'],
    status: 'ACTIVE',
    tokenVersion: 1,
    policyVersion: 1,
  });
  await h.connection.collection('patient_access_projection').insertOne({
    patientId: patient,
    ownerUserId: owner,
    active: true,
    policyVersion: 1,
  });
  await h.connection.collection('catalog_projection').insertMany([
    {
      entityKey: 'MEDICINE:' + medicine,
      entityType: 'MEDICINE',
      entityId: medicine,
      entityVersion: 1,
      active: true,
      fullSnapshot: { id: medicine, code: 'MED-1', name: 'Medicine', status: 'ACTIVE' },
    },
    {
      entityKey: 'PRICE_VERSION:' + medicine,
      entityType: 'PRICE_VERSION',
      entityId: key(),
      entityVersion: 1,
      active: true,
      fullSnapshot: {
        itemId: medicine,
        priceVersionId: key(),
        revision: 1,
        amountVnd: 1000,
        effectiveFrom: '2026-01-01T00:00:00Z',
      },
    },
  ]);
  await h.connection.collection('projection_checkpoints').insertOne({
    projectionName: 'CatalogChanged',
    gap: false,
    streamSequence: 2,
    lastCheckpointAt: now,
  });
  await h.connection
    .collection('inventory')
    .insertOne({ id: key(), medicineId: medicine, onHand: 5, reserved: 0, version: 1 });
});
test('FAILED before reserve persists a tombstone and prevents a late lock', async () => {
  await project();
  const result = await hold();
  const holdId = result.holdId || result.data?.holdId;
  const chargeId = key(),
    settlementId = key();
  await billing('ChargePrepared', holdId, { chargeId, state: 'CREATED' });
  await billing('SettlementDecision', holdId, {
    settlementId,
    state: 'FAILED',
    decisionVersion: 1,
    sourceType: undefined,
    chargeId: undefined,
    fence: undefined,
  });
  assert.equal((await row(holdId)).status, 'HELD');
  assert.equal(
    await h.connection
      .collection('settlement_decisions')
      .countDocuments({ settlementId, state: 'FAILED' }),
    1,
  );
  assert.equal((await billing('ReserveSettlement', holdId, { settlementId })).state, 'REJECTED');
  assert.equal((await row(holdId)).status, 'HELD');
});

test('reserve ahead of ChargePrepared retries durably and original version replays the accepted result', async () => {
  await project();
  const first = await hold();
  const original = await row(first.holdId);
  const chargeId = key(),
    settlementId = key();
  await assert.rejects(
    billing('ReserveSettlement', first.holdId, { chargeId, settlementId }),
    bad('CHARGE_PENDING_SYNC'),
  );
  await billing('ChargePrepared', first.holdId, { chargeId, state: 'CREATED' });
  const accepted = await billing('ReserveSettlement', first.holdId, {
    settlementId,
    attemptVersion: original.version,
  });
  assert.equal(accepted.state, 'ACCEPTED');
  const repeated = await billing('ReserveSettlement', first.holdId, {
    settlementId,
    attemptVersion: original.version,
  });
  assert.equal(repeated.fence, accepted.fence);
  assert.equal((await row(first.holdId)).version, original.version + 1);
  assert.equal(
    await h.connection.collection('outbox').countDocuments({ message_type: 'SettlementReserved' }),
    1,
  );
});
test('expired reserve produces a durable REJECTED response for Billing', async () => {
  await project();
  const first = await hold();
  await billing('ChargePrepared', first.holdId, { chargeId: key(), state: 'CREATED' });
  await h.connection
    .collection('medication_holds')
    .updateOne({ id: first.holdId }, { $set: { expiresAt: now } });
  assert.equal(
    (await billing('ReserveSettlement', first.holdId, { settlementId: key() })).state,
    'REJECTED',
  );
  const response = await h.connection
    .collection('outbox')
    .findOne({ message_type: 'SettlementReserved' });
  assert.equal(response.payload.state, 'REJECTED');
  assert.equal((await row(first.holdId)).status, 'HELD');
});
test('identical command redelivery reissues its stored response with the original fence', async () => {
  await project();
  const first = await hold();
  await billing('ChargePrepared', first.holdId, { chargeId: key(), state: 'CREATED' });
  const r = await row(first.holdId);
  const message = {
    messageId: key(),
    messageKind: 'COMMAND',
    messageType: 'ReserveSettlement',
    producer: 'billing',
    schemaVersion: 1,
    payload: {
      sourceType: 'PHARMACY',
      sourceId: r.id,
      sourceRevision: r.attemptNo,
      settlementId: key(),
      chargeId: r.chargeId,
      amountHash: r.snapshotHash,
      attemptVersion: r.version,
    },
  };
  const accepted = await handleBillingMessage({ connection: h.connection, now, message });
  await h.connection
    .collection('outbox')
    .updateOne({ message_id: accepted.responseMessageId }, { $set: { published_at: now } });
  const repeated = await handleBillingMessage({ connection: h.connection, now, message });
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.fence, accepted.fence);
  const response = await h.connection
    .collection('outbox')
    .findOne({ message_id: accepted.responseMessageId });
  assert.equal(response.published_at, null);
  assert.equal(
    await h.connection.collection('outbox').countDocuments({ message_type: 'SettlementReserved' }),
    1,
  );
});

test('FAILED cannot discard verified payment or unlock reserved stock', async () => {
  await project();
  const first = await hold();
  await billing('ChargePrepared', first.holdId, { chargeId: key(), state: 'CREATED' });
  await billing('ReserveSettlement', first.holdId, { settlementId: key() });
  await billing('ChargePaid', first.holdId, {
    transactionId: 'TXN-PAID',
    paidAt: now.toISOString(),
  });
  await assert.rejects(
    billing('SettlementDecision', first.holdId, { state: 'FAILED', decisionVersion: 1 }),
    bad('MESSAGE_CONFLICT'),
  );
  await expireMedicationHolds({ connection: h.connection, now: new Date(now.getTime() + 3600000) });
  const locked = await row(first.holdId);
  assert.equal(locked.status, 'SETTLEMENT_LOCKED');
  assert.equal(locked.paidEvidence.transactionId, 'TXN-PAID');
  assert.equal(
    (await h.connection.collection('inventory').findOne({ medicineId: medicine })).reserved,
    1,
  );
});

test('FINAL projection replays, rejects same revision changed content and rejects untrusted producer', async () => {
  const m = await project();
  assert.equal(
    (await applyPrescriptionFinalized({ connection: h.connection, message: m, now })).duplicate,
    true,
  );
  await assert.rejects(
    applyPrescriptionFinalized({
      connection: h.connection,
      message: {
        ...m,
        messageId: key(),
        payload: { ...m.payload, itemsSnapshot: [{ medicineCode: 'MED-1', quantity: 2 }] },
      },
      now,
    }),
    bad('PROJECTION_CONFLICT'),
  );
  await assert.rejects(project({ ...m, producer: 'browser' }), bad('INVALID_MESSAGE'));
});
test('receipt replay adds stock and audit exactly once; changed body conflicts', async () => {
  const idempotencyKey = key();
  const input = { ...ctx(), medicineId: medicine, quantity: 3, idempotencyKey };
  const first = await receiveStock(input);
  assert.deepEqual(await receiveStock(input), first);
  await assert.rejects(receiveStock({ ...input, quantity: 4 }), bad('IDEMPOTENCY_KEY_REUSED'));
  const stock = await h.connection.collection('inventory').findOne({ medicineId: medicine });
  assert.equal(stock.onHand, 8);
  assert.equal(await h.connection.collection('stock_receipts').countDocuments(), 1);
  assert.equal(await h.connection.collection('stock_audit').countDocuments(), 1);
  await assert.rejects(
    receiveStock({ ...input, quantity: 1.5, idempotencyKey: key() }),
    bad('VALIDATION_ERROR'),
  );
});
test('hold reserves full FINAL prescription and RequestCharge together and replays same intent', async () => {
  await project();
  const idempotencyKey = key();
  const first = await hold(rx, idempotencyKey);
  assert.equal(first.state, 'HELD');
  assert.deepEqual(await hold(rx, idempotencyKey), first);
  assert.equal(
    (await h.connection.collection('inventory').findOne({ medicineId: medicine })).reserved,
    1,
  );
  const outbox = await h.connection.collection('outbox').findOne({ message_type: 'RequestCharge' });
  assert.equal(outbox.payload.sourceType, 'PHARMACY');
  assert.equal(outbox.payload.sourceRevision, 1);
  assert.equal(outbox.payload.amountVnd, 1000);
  assert.equal(outbox.payload.recipientUserId, owner);
  assert.equal(new Date((await row(first.holdId)).expiresAt) - now, 900000);
});
test('twenty concurrent full prescriptions cannot oversell the last unit', async () => {
  await h.connection
    .collection('inventory')
    .updateOne({ medicineId: medicine }, { $set: { onHand: 1 } });
  const ids = Array.from({ length: 20 }, key);
  for (const id of ids) await project(finalized(id));
  const results = await Promise.allSettled(ids.map((id) => hold(id)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const stock = await h.connection.collection('inventory').findOne({ medicineId: medicine });
  assert.equal(stock.reserved, 1);
  assert.equal(stock.onHand, 1);
  assert.equal(
    await h.connection.collection('outbox').countDocuments({ message_type: 'RequestCharge' }),
    1,
  );
});
test('missing second medicine rolls back first reservation, hold and outbox', async () => {
  const m = finalized();
  m.payload.itemsSnapshot.push({ medicineCode: 'MISSING', quantity: 1, doseText: 'once' });
  await project(m);
  await assert.rejects(hold(), (error) =>
    ['INSUFFICIENT_STOCK', 'SERVICE_UNAVAILABLE'].includes(error.code),
  );
  assert.equal(
    (await h.connection.collection('inventory').findOne({ medicineId: medicine })).reserved,
    0,
  );
  assert.equal(await h.connection.collection('medication_holds').countDocuments(), 0);
  assert.equal(await h.connection.collection('outbox').countDocuments(), 0);
});
test('release and expiry race returns reservation once and rehold increments stable source attempt', async () => {
  await project();
  const first = await hold();
  await Promise.allSettled([
    releaseMedicationHold({
      ...ctx(),
      holdId: first.holdId,
      expectedVersion: 1,
      idempotencyKey: key(),
    }),
    expireMedicationHolds({ connection: h.connection, now: new Date(now.getTime() + 900000) }),
  ]);
  assert.equal(
    (await h.connection.collection('inventory').findOne({ medicineId: medicine })).reserved,
    0,
  );
  const next = await hold();
  assert.equal(next.holdId, first.holdId);
  assert.equal((await row(next.holdId)).attemptNo, 2);
  assert.equal((await row(next.holdId)).attemptHistory.length, 1);
  await assert.rejects(
    billing('ChargePaid', next.holdId, { sourceRevision: 1 }),
    bad('SOURCE_MISMATCH'),
  );
});
test('UNKNOWN remains locked after expiry and cannot be dispensed or released', async () => {
  await project();
  const first = await hold();
  await billing('ChargePrepared', first.holdId, { chargeId: key(), state: 'CREATED' });
  await billing('ReserveSettlement', first.holdId, { settlementId: key() });
  await billing('SettlementDecision', first.holdId, { state: 'UNKNOWN', decisionVersion: 1 });
  await expireMedicationHolds({ connection: h.connection, now: new Date(now.getTime() + 900001) });
  assert.equal((await row(first.holdId)).status, 'SETTLEMENT_LOCKED');
  await assert.rejects(
    releaseMedicationHold({
      ...ctx(),
      holdId: first.holdId,
      expectedVersion: (await row(first.holdId)).version,
      idempotencyKey: key(),
    }),
    bad('STATE_CONFLICT'),
  );
  await assert.rejects(
    dispenseMedication({
      ...ctx(),
      holdId: first.holdId,
      expectedVersion: (await row(first.holdId)).version,
      idempotencyKey: key(),
    }),
    bad('SETTLEMENT_NOT_CONFIRMED'),
  );
});
test('PAID evidence commits locally and two dispensers issue exactly once without double stock decrement', async () => {
  await project();
  const first = await hold();
  await paid(first.holdId);
  const committed = await row(first.holdId);
  assert.equal(committed.status, 'COMMITTED');
  assert.equal(
    (await h.connection.collection('inventory').findOne({ medicineId: medicine })).onHand,
    5,
  );
  const input = {
    ...ctx(),
    holdId: first.holdId,
    expectedVersion: committed.version,
    idempotencyKey: key(),
  };
  const results = await Promise.allSettled([
    dispenseMedication(input),
    dispenseMedication({ ...input, idempotencyKey: key() }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const stock = await h.connection.collection('inventory').findOne({ medicineId: medicine });
  assert.equal(stock.onHand, 4);
  assert.equal(stock.reserved, 0);
  assert.equal(await h.connection.collection('dispenses').countDocuments(), 1);
  const event = await h.connection
    .collection('outbox')
    .findOne({ message_type: 'MedicationDispensed' });
  assert.equal(event.payload.recipientUserId, owner);
  assert.equal(event.payload.itemsSnapshot, undefined);
});
test('fence and amount mismatch never commit; reconcile does not manufacture payment', async () => {
  await project();
  const first = await hold();
  const pending = await reconcileMedicationHold({
    ...ctx(),
    holdId: first.holdId,
    expectedAttemptNo: 1,
    idempotencyKey: key(),
  });
  assert.equal(pending.state, 'HELD');
  await billing('ChargePrepared', first.holdId, { chargeId: key(), state: 'CREATED' });
  await billing('ReserveSettlement', first.holdId, { settlementId: key() });
  await assert.rejects(
    billing('ChargePaid', first.holdId, { fence: 'PAID' }),
    bad('SETTLEMENT_MISMATCH'),
  );
  await assert.rejects(
    billing('ChargePaid', first.holdId, { amountVnd: 2 }),
    bad('AMOUNT_MISMATCH'),
  );
  assert.equal((await row(first.holdId)).status, 'SETTLEMENT_LOCKED');
});
test('revoked staff cannot reserve or receive stock even with a previously valid token', async () => {
  await project();
  await h.connection
    .collection('user_access_projection')
    .updateOne({ userId: staff }, { $set: { status: 'REVOKED' } });
  await assert.rejects(hold(), bad('FORBIDDEN'));
  await assert.rejects(
    receiveStock({ ...ctx(), medicineId: medicine, quantity: 1, idempotencyKey: key() }),
    bad('FORBIDDEN'),
  );
});
test('FAILED decision before timeout allows a new settlement with a higher fence and reset decision version', async () => {
  await project();
  const first = await hold();
  await billing('ChargePrepared', first.holdId, { chargeId: key(), state: 'CREATED' });
  const priorSettlement = key();
  await billing('ReserveSettlement', first.holdId, { settlementId: priorSettlement });
  await billing('SettlementDecision', first.holdId, { state: 'FAILED', decisionVersion: 10 });
  assert.equal((await row(first.holdId)).status, 'HELD');
  assert.equal(
    (await billing('ReserveSettlement', first.holdId, { settlementId: priorSettlement })).state,
    'REJECTED',
  );
  await billing('ReserveSettlement', first.holdId, { settlementId: key() });
  assert.equal((await row(first.holdId)).fence, 2);
  await billing('SettlementDecision', first.holdId, {
    state: 'SUCCEEDED',
    decisionVersion: 1,
    paymentId: key(),
  });
  await billing('ChargePaid', first.holdId, { transactionId: key(), paidAt: now.toISOString() });
  assert.equal((await row(first.holdId)).status, 'COMMITTED');
});
test('late prepared on expired source emits stable cancellation basis but never resurrects it', async () => {
  await project();
  const first = await hold();
  await expireMedicationHolds({ connection: h.connection, now: new Date(now.getTime() + 900001) });
  await billing('ChargePrepared', first.holdId, { chargeId: key(), state: 'CREATED' });
  assert.equal((await row(first.holdId)).status, 'EXPIRED');
  const changes = await h.connection
    .collection('outbox')
    .find({ message_type: 'MedicationHoldChanged' })
    .toArray();
  assert.equal(changes.length, 2);
  assert.equal(changes[0].payload.cancellationId, changes[1].payload.cancellationId);
  await assert.rejects(
    billing('ChargePaid', first.holdId, { settlementId: key(), transactionId: key() }),
    bad('SETTLEMENT_MISMATCH'),
  );
});
test('receipt mutation rollback also removes stock increment when audit write fails', async () => {
  const audit = h.connection.collection('stock_audit');
  await audit.createIndex(
    { failureMarker: 1 },
    { unique: true, name: 'test_audit_fault', partialFilterExpression: { kind: 'RECEIPT' } },
  );
  try {
    await receiveStock({ ...ctx(), medicineId: medicine, quantity: 1, idempotencyKey: key() });
    await assert.rejects(
      receiveStock({ ...ctx(), medicineId: medicine, quantity: 1, idempotencyKey: key() }),
    );
    assert.equal(
      (await h.connection.collection('inventory').findOne({ medicineId: medicine })).onHand,
      6,
    );
  } finally {
    await audit.dropIndex('test_audit_fault');
  }
});
