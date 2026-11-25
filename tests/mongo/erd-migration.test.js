const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { mongoHarness } = require('./test-harness');
const { ensurePatientStorage } = require('../../services/patient/src/dbs/indexes');
const { ensurePharmacyStorage } = require('../../services/pharmacy/src/dbs/indexes');
const { migrateBusinessStorage, auditBusinessStorage } = require('../../mongo/erd-storage');
const { restoreBusinessStorage } = require('../../mongo/erd-cli');
const h = mongoHarness(ensurePatientStorage);
test('ERD migration dry-run preserves legacy rows; apply backs up canonical data and rollback verifies checksums', async () => {
  const row = {
    id: randomUUID(),
    ownerUserId: randomUUID(),
    relation: 'SELF',
    fullName: 'Legacy Patient',
    birthDate: '1990-01-01',
    version: 1,
    policyVersion: 1,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    legacyTag: 'remove',
  };
  await h.connection.collection('patients').insertOne({ ...row });
  const preview = await migrateBusinessStorage(h.connection, { service: 'patient' });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.report[0].changed, 1);
  assert.equal(
    (await h.connection.collection('patients').findOne({ id: row.id })).birthDate,
    '1990-01-01',
  );
  await assert.rejects(
    migrateBusinessStorage(h.connection, { service: 'patient', apply: true }),
    /stopped writers/,
  );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'umc-erd-migration-test-'));
  await migrateBusinessStorage(h.connection, {
    service: 'patient',
    apply: true,
    writersStopped: true,
    backupDir: directory,
  });
  const current = await h.connection.collection('patients').findOne({ id: row.id });
  assert.ok(current.birthDate instanceof Date);
  assert.equal(current.legacyTag, undefined);
  assert.ok(
    (await auditBusinessStorage(h.connection, 'patient')).every((entry) => entry.invalid === 0),
  );
  await assert.rejects(
    h.connection.collection('patients').updateOne({ id: row.id }, { $set: { legacyTag: 'bad' } }),
    (error) => error.code === 121,
  );
  await restoreBusinessStorage(h.connection, {
    service: 'patient',
    backupDir: directory,
    writersStopped: true,
  });
  const restored = await h.connection.collection('patients').findOne({ id: row.id });
  assert.equal(restored.birthDate, row.birthDate);
  assert.equal(restored.legacyTag, 'remove');
  await fs.appendFile(path.join(directory, 'patients.json'), ' ');
  await assert.rejects(
    restoreBusinessStorage(h.connection, {
      service: 'patient',
      backupDir: directory,
      writersStopped: true,
    }),
    /checksum mismatch/,
  );
});
test('ERD migration never converts an unsupported legacy paid flag into payment evidence', async () => {
  const connection = h.connection.useDb('erd_legacy_pharmacy', { useCache: true });
  await ensurePharmacyStorage(connection);
  const row = {
    id: randomUUID(),
    prescriptionId: randomUUID(),
    revision: 1,
    attemptNo: 1,
    status: 'COMMITTED',
    itemsSnapshot: [],
    expiresAt: new Date(),
    chargeId: null,
    version: 1,
    attemptHistory: [],
    patientId: randomUUID(),
    settlementId: null,
    settlementState: 'SUCCEEDED',
    settlementVersion: 1,
    paidEvidence: { fake: true },
  };
  await connection.collection('medication_holds').insertOne({ ...row });
  await assert.rejects(
    migrateBusinessStorage(connection, { service: 'pharmacy' }),
    /LEGACY_PAYMENT_RECEIPT_REQUIRED/,
  );
  assert.deepEqual(
    (await connection.collection('medication_holds').findOne({ id: row.id })).paidEvidence,
    { fake: true },
  );
  assert.equal(await connection.collection('inbox').countDocuments(), 0);
  assert.equal(await connection.collection('settlement_decisions').countDocuments(), 0);
});

test('strict schema startup is repeatable without collMod privileges', async (t) => {
  const c = h.connection.useDb('erd_readwrite_startup', { useCache: true });
  const { installBusinessValidators } = require('../../mongo/erd-storage');
  await ensurePatientStorage(c);
  await installBusinessValidators(c, 'patient');
  const original = c.db.command.bind(c.db);
  c.db.command = async (command, ...args) => {
    if (command.collMod) throw Object.assign(new Error('Unauthorized'), { code: 13 });
    return original(command, ...args);
  };
  t.after(() => {
    c.db.command = original;
  });
  await installBusinessValidators(c, 'patient');
  await original({ collMod: 'patients', validator: {} });
  await assert.rejects(installBusinessValidators(c, 'patient'), /migration role/);
});
