const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mongoHarness } = require('./test-harness');
const { ensurePharmacyStorage } = require('../../services/pharmacy/src/dbs/indexes');
const { createApp } = require('../../services/pharmacy/src/app');
const { validatePharmacyResponse } = require('./validate-pharmacy-contract');
const { handleBillingMessage } = require('../../services/pharmacy/src/services/settlement.service');
const h = mongoHarness(ensurePharmacyStorage);
const staff = '00000000-0000-4000-8000-000000000902';
const owner = '00000000-0000-4000-8000-000000000901';
const patient = '00000000-0000-4000-8000-000000000701';
const medicine = '00000000-0000-4000-8000-000000000301';
const rx = '00000000-0000-4000-8000-000000000501';
const now = new Date('2026-11-07T00:00:00Z');
const crypto = require('node:crypto');
const { createJwtVerifier } = require('../../mongo/jwt-verifier');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const verifyLease = createJwtVerifier({ publicKey, now: () => now.getTime() / 1000 });
function leaseFor(principal, action, overrides = {}) {
  const payload = {
    iss: 'umc-care-identity',
    aud: 'umc-care-services',
    sub: principal,
    action,
    tokenType: 'LEASE',
    tokenVersion: 1,
    iat: now.getTime() / 1000,
    exp: now.getTime() / 1000 + 30,
    ...overrides,
  };
  const data =
    Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256' })).toString('base64url') +
    '.' +
    Buffer.from(JSON.stringify(payload)).toString('base64url');
  return (
    data + '.' + crypto.sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')
  );
}
const claims = {
  staff: { sub: staff, actorType: 'STAFF', capabilities: ['PHARMACY'], tokenVersion: 1 },
  owner: { sub: owner, actorType: 'PATIENT', capabilities: [], tokenVersion: 1 },
  stranger: {
    sub: '00000000-0000-4000-8000-000000000999',
    actorType: 'PATIENT',
    capabilities: [],
    tokenVersion: 1,
  },
};
beforeEach(async () => {
  await h.connection.collection('user_access_projection').insertMany(
    Object.values(claims).map((c) => ({
      userId: c.sub,
      ...c,
      status: 'ACTIVE',
      policyVersion: 1,
    })),
  );
  await h.connection
    .collection('patient_access_projection')
    .insertOne({ patientId: patient, ownerUserId: owner, active: true, policyVersion: 1 });
  await h.connection
    .collection('catalog_projection')
    .insertOne({
      entityKey: 'MEDICINE:' + medicine,
      entityType: 'MEDICINE',
      entityId: medicine,
      active: true,
      fullSnapshot: { code: 'MED-1', name: 'Medicine', status: 'ACTIVE' },
    });
  await h.connection
    .collection('inventory')
    .insertOne({ id: randomUUID(), medicineId: medicine, onHand: 10, reserved: 2, version: 1 });
  await h.connection
    .collection('prescription_projection')
    .insertOne({
      id: rx,
      prescriptionId: rx,
      revision: 1,
      state: 'FINAL',
      patientId: patient,
      visitId: randomUUID(),
      itemsSnapshot: [{ medicineCode: 'MED-1', quantity: 1 }],
    });
  await h.connection
    .collection('catalog_projection')
    .insertOne({
      entityKey: 'PRICE:' + medicine,
      entityType: 'PRICE_VERSION',
      entityId: randomUUID(),
      active: true,
      entityVersion: 1,
      fullSnapshot: {
        itemId: medicine,
        amountVnd: 1000,
        effectiveFrom: '2026-01-01T00:00:00Z',
        priceVersionId: randomUUID(),
        revision: 1,
      },
    });
  await h.connection
    .collection('projection_checkpoints')
    .insertOne({
      projectionName: 'CatalogChanged',
      gap: false,
      lastCheckpointAt: now,
      streamSequence: 1,
    });
});
async function api(t) {
  const app = createApp({
    connection: h.connection,
    verifyBearerToken: async (token) => claims[token],
    verifyAuthorizationLease: verifyLease,
    now: () => now,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (path, token, init = {}) => {
    const method = init.method || 'GET';
    const action = path.startsWith('/stock/receipts')
      ? 'PH-002'
      : path.startsWith('/prescriptions/queue')
        ? 'PH-003'
        : path.startsWith('/prescriptions/')
          ? method === 'POST'
            ? 'PH-005'
            : 'PH-004'
          : path.includes('/dispense')
            ? 'PH-008'
            : path.includes('/commit')
              ? 'PH-007'
              : 'PH-006';
    const response = await fetch(
      'http://127.0.0.1:' + server.address().port + '/api/v1/pharmacy' + path,
      {
        ...init,
        headers: {
          authorization: token ? 'Bearer ' + token : '',
          'x-correlation-id': 'ph-api-test',
          'x-authorization-lease': claims[token] ? leaseFor(claims[token].sub, action) : '',
          ...init.headers,
        },
      },
    );
    const body = await response.json();
    validatePharmacyResponse(init.method || 'GET', path, response.status, body);
    return { status: response.status, body };
  };
}
test('Pharmacy requires a signed lease bound to action subject version and a strict 30-second lifetime', async (t) => {
  const request = await api(t);
  const path = '/prescriptions/' + rx;
  for (const token of [
    '',
    leaseFor(owner, 'PH-008'),
    leaseFor(staff, 'PH-004'),
    leaseFor(owner, 'PH-004', { tokenVersion: 2 }),
    leaseFor(owner, 'PH-004', { iat: now.getTime() / 1000 - 30, exp: now.getTime() / 1000 }),
    leaseFor(owner, 'PH-004', { exp: now.getTime() / 1000 + 31 }),
  ]) {
    assert.equal(
      (await request(path, 'owner', { headers: { 'x-authorization-lease': token } })).status,
      token && JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).exp <= now.getTime()/1000 ? 401 : 403,
    );
  }
  assert.equal((await request(path, 'owner')).status, 200);
});

test('PH-001 serves available stock and rejects missing/foreign capability', async (t) => {
  const request = await api(t);
  const result = await request('/stock', 'staff');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.items[0].available, 8);
  assert.equal(result.body.meta.correlationId, 'ph-api-test');
  assert.equal((await request('/stock')).status, 401);
  assert.equal((await request('/stock', 'owner')).status, 403);
  assert.equal((await request('/stock?limit=101', 'staff')).status, 400);
  assert.equal((await request('/stock?code=NO-MATCH', 'staff')).body.data.total, 0);
});
test('PH-004 patient DTO never leaks stock, prescription contents, other owners or holds', async (t) => {
  const request = await api(t);
  const result = await request('/prescriptions/' + rx, 'owner');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.view, 'PATIENT_STATUS');
  for (const field of ['stock', 'prescription', 'holds', 'itemsSnapshot'])
    assert.equal(result.body.data[field], undefined);
  assert.equal((await request('/prescriptions/' + rx, 'stranger')).status, 404);
  const staffView = await request('/prescriptions/' + rx, 'staff');
  assert.equal(staffView.body.data.view, 'PHARMACY');
  assert.ok(Array.isArray(staffView.body.data.stock));
});
test('PH-002 validates schema and preserves replay; request cannot override staff identity', async (t) => {
  const request = await api(t),
    key = randomUUID();
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ medicineId: medicine, quantity: 2, batchRef: 'TEST' }),
  };
  const first = await request('/stock/receipts', 'staff', init);
  assert.equal(first.status, 201);
  assert.equal(
    (await request('/stock/receipts', 'staff', init)).body.data.stockReceiptId,
    first.body.data.stockReceiptId,
  );
  assert.equal((await request('/stock/receipts', 'owner', init)).status, 403);
  assert.equal(
    (
      await request('/stock/receipts', 'staff', {
        ...init,
        body: JSON.stringify({ medicineId: medicine, quantity: 2, actorUserId: owner }),
      })
    ).status,
    400,
  );
});
test('current projection revocation takes precedence over cached bearer claims', async (t) => {
  const request = await api(t);
  await h.connection
    .collection('user_access_projection')
    .updateOne({ userId: staff }, { $set: { tokenVersion: 2 } });
  assert.equal((await request('/stock', 'staff')).status, 403);
});
test('PH-003 and PH-005..008 use actual HTTP responses validated against OpenAPI', async (t) => {
  const request = await api(t);
  const post = (body) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    body: JSON.stringify(body),
  });
  assert.equal((await request('/prescriptions/queue', 'staff')).body.data.items.length, 1);
  const first = await request(
    '/prescriptions/' + rx + '/holds',
    'staff',
    post({ prescriptionRevision: 1 }),
  );
  assert.equal(first.status, 202);
  const holdId = first.body.data.holdId;
  assert.equal(
    (await request('/holds/' + holdId + '/commit', 'staff', post({ expectedAttemptNo: 1 }))).status,
    202,
  );
  assert.equal(
    (await request('/holds/' + holdId + '/dispense', 'staff', post({ expectedVersion: 1 }))).status,
    409,
  );
  assert.equal(
    (
      await request('/holds/' + holdId + '?expectedVersion=1', 'staff', {
        method: 'DELETE',
        headers: { 'idempotency-key': randomUUID() },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request('/prescriptions/' + rx + '/holds', 'staff', post({ prescriptionRevision: 1 })))
      .status,
    202,
  );
  async function event(type, extra = {}) {
    const hold = await h.connection.collection('medication_holds').findOne({ id: holdId });
    return handleBillingMessage({
      connection: h.connection,
      now,
      message: {
        messageId: randomUUID(),
        messageType: type,
        messageKind: type === 'ReserveSettlement' ? 'COMMAND' : 'EVENT',
        producer: 'billing',
        schemaVersion: 1,
        payload: {
          sourceType: 'PHARMACY',
          sourceId: holdId,
          sourceRevision: hold.attemptNo,
          chargeId: hold.chargeId,
          settlementId: hold.settlementId,
          fence: hold.fence,
          amountHash: hold.snapshotHash,
          attemptVersion: type === 'ReserveSettlement' ? (extra.settlementId && extra.settlementId !== hold.settlementId ? (hold.reserveAttemptVersion || 0) + 1 : (hold.reserveAttemptVersion || 1)) : hold.version,
          amountVnd: hold.amountVnd,
          ...extra,
        },
      },
    });
  }
  await event('ChargePrepared', { state: 'CREATED', chargeId: randomUUID() });
  await event('ReserveSettlement', { settlementId: randomUUID() });
  await event('ChargePaid', { transactionId: randomUUID(), paidAt: now.toISOString() });
  await event('SettlementDecision', {
    state: 'SUCCEEDED',
    decisionVersion: 1,
    paymentId: randomUUID(),
  });
  const detail = await request('/prescriptions/' + rx, 'staff');
  const currentHold = detail.body.data.holds[0];
  assert.equal(currentHold.status, 'COMMITTED');
  const dispense = await request(
    '/holds/' + holdId + '/dispense',
    'staff',
    post({ expectedVersion: currentHold.version }),
  );
  assert.equal(dispense.status, 200);
  assert.equal(dispense.body.data.state, 'DISPENSED');
  assert.equal((await request('/prescriptions/queue', 'staff')).body.data.total, 0);
  const minimal = await request('/prescriptions/' + rx, 'owner');
  assert.equal(minimal.body.data.latestHoldState, 'DISPENSED');
  assert.equal(minimal.body.data.stock, undefined);
});
