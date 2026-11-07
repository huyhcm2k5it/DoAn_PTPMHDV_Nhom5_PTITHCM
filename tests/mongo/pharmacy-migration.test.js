const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mongoHarness } = require('./test-harness');
const { ensurePharmacyStorage } = require('../../services/pharmacy/src/dbs/indexes');
const { migrateLegacyPharmacy } = require('../../services/pharmacy/scripts/migrate-storage');
const h = mongoHarness(ensurePharmacyStorage);
test('seed is insert-only and repeatable without resetting real inventory or reservations', async () => {
  const { seed, ids } = require('../../services/pharmacy/scripts/seed-demo');
  await seed({ connection: h.connection, dryRun: true });
  assert.equal(await h.connection.collection('inventory').countDocuments(), 0);
  await seed({ connection: h.connection, dryRun: false });
  await h.connection
    .collection('inventory')
    .updateOne({ medicineId: ids.medicine }, { $set: { onHand: 20, reserved: 2 } });
  await seed({ connection: h.connection, dryRun: false });
  const row = await h.connection.collection('inventory').findOne({ medicineId: ids.medicine });
  assert.equal(row.onHand, 20);
  assert.equal(row.reserved, 2);
  assert.equal(await h.connection.collection('inventory').countDocuments(), 1);
});
test('legacy inactive migration is additive and repeatable without dropping indexes or data', async () => {
  const id = randomUUID();
  await h.connection
    .collection('medication_holds')
    .insertOne({ id, prescriptionId: randomUUID(), revision: 1, status: 'EXPIRED' });
  assert.equal((await migrateLegacyPharmacy(h.connection)).legacy, 1);
  assert.equal(
    (await h.connection.collection('medication_holds').findOne({ id })).attemptNo,
    undefined,
  );
  await migrateLegacyPharmacy(h.connection, { dryRun: false });
  await migrateLegacyPharmacy(h.connection, { dryRun: false });
  const row = await h.connection.collection('medication_holds').findOne({ id });
  assert.equal(row.attemptNo, 1);
  assert.equal(row.status, 'EXPIRED');
  assert.equal(await h.connection.collection('medication_holds').countDocuments(), 1);
  assert.ok(
    (await h.connection.collection('dispenses').indexes()).some(
      (i) => i.name === 'uq_dispense_prescription_revision',
    ),
  );
});
test('migration refuses to invent payment or stock evidence for an active legacy hold', async () => {
  await h.connection
    .collection('medication_holds')
    .insertOne({
      id: randomUUID(),
      prescriptionId: randomUUID(),
      revision: 1,
      status: 'COMMITTED',
    });
  await assert.rejects(
    migrateLegacyPharmacy(h.connection, { dryRun: false }),
    /LEGACY_DATA_REQUIRES_REVIEW/,
  );
});
test('inventory lookup uses the owner business unique index', async () => {
  await h.connection
    .collection('inventory')
    .insertOne({ id: randomUUID(), medicineId: randomUUID(), onHand: 2, reserved: 0 });
  const plan = await h.connection
    .collection('inventory')
    .find({ medicineId: randomUUID() })
    .explain('queryPlanner');
  assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /uq_inventory_medicine/);
});
