const fs = require('node:fs/promises');
const { isDeepStrictEqual } = require('node:util');
const crypto = require('node:crypto');
const path = require('node:path');
const specification = require('./erd-business-validators.json');
const owners = {
  patient: ['patients', 'profile_audit'],
  appointment: [
    'schedules',
    'slots',
    'holds',
    'appointments',
    'queue_tickets',
    'patient_time_locks',
  ],
  pharmacy: [
    'inventory',
    'stock_receipts',
    'prescription_projection',
    'medication_holds',
    'dispenses',
  ],
};

function jsonSchema(validator) {
  return validator.$jsonSchema || validator.$and[0].$jsonSchema;
}
function businessDocument(name, value, BSON) {
  const { Long } = BSON;
  const properties = jsonSchema(specification.validators[name]).properties;
  const result = Object.fromEntries(
    Object.keys(properties)
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
  if (name === 'patients' && typeof result.birthDate === 'string') {
    const date = new Date(result.birthDate + 'T00:00:00.000Z');
    if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== result.birthDate)
      throw new Error('INVALID_LEGACY_BIRTH_DATE');
    result.birthDate = date;
  }
  if (
    name === 'appointments' &&
    result.priceSnapshotVnd != null &&
    !Long.isLong(result.priceSnapshotVnd)
  ) {
    if (!Number.isSafeInteger(Number(result.priceSnapshotVnd)))
      throw new Error('UNSAFE_LEGACY_AMOUNT');
    result.priceSnapshotVnd = Long.fromString(String(result.priceSnapshotVnd));
  }
  return result;
}

async function validDocument(connection, name, value) {
  const rows = await connection.db
    .aggregate([{ $documents: [value] }, { $match: specification.validators[name] }, { $limit: 1 }])
    .toArray();
  return rows.length === 1;
}

async function auditBusinessStorage(connection, service) {
  if (!owners[service]) throw new Error('Unknown ERD owner.');
  const report = [];
  for (const name of owners[service]) {
    const invalidQuery = { $nor: [specification.validators[name]] };
    const count = await connection.collection(name).countDocuments();
    const invalid = await connection.collection(name).countDocuments(invalidQuery);
    const examples = (
      await connection
        .collection(name)
        .find(invalidQuery, { projection: { id: 1, patientId: 1 } })
        .limit(10)
        .toArray()
    ).map((row) => String(row.id || row.patientId || row._id));
    report.push({ name, count, invalid, examples });
  }
  return report;
}

async function installBusinessValidators(connection, service) {
  const report = await auditBusinessStorage(connection, service);
  if (report.some((row) => row.invalid))
    throw new Error('ERD_SCHEMA_MIGRATION_REQUIRED: ' + JSON.stringify(report));
  for (const name of owners[service]) {
    const existing = await connection.db.listCollections({ name }).next();
    if (!existing)
      await connection.createCollection(name, {
        validator: specification.validators[name],
        validationLevel: 'strict',
        validationAction: 'error',
      });
    else if (
      !isDeepStrictEqual(existing.options.validator, specification.validators[name]) ||
      (existing.options.validationLevel || 'strict') !== 'strict' ||
      (existing.options.validationAction || 'error') !== 'error'
    ) {
      try {
        await connection.db.command({
          collMod: name,
          validator: specification.validators[name],
          validationLevel: 'strict',
          validationAction: 'error',
        });
      } catch (error) {
        if (error.code === 13)
          throw new Error(
            'ERD_SCHEMA_MIGRATION_REQUIRED: install validators with a migration role before starting ' +
              service,
          );
        throw error;
      }
    }
  }
  return report;
}

async function verifyTechnicalSources(connection, name, original, candidate) {
  const { EJSON } = connection.base.mongo.BSON;
  if (name === 'appointments') {
    const {
      hydrateAppointment,
    } = require('../services/appointment/src/services/appointment.repository');
    const view = await hydrateAppointment(connection, candidate);
    for (const key of [
      'sourceRevision',
      'fenceCounter',
      'reserveAttemptVersion',
      'cancellationId',
      'visitId',
    ])
      if (original[key] != null && original[key] !== view[key])
        throw new Error('LEGACY_TECHNICAL_EVIDENCE_REQUIRED:' + name + ':' + key);
    if (original.chargeStatus === 'PAID' && view.chargeStatus !== 'PAID')
      throw new Error('LEGACY_PAYMENT_RECEIPT_REQUIRED');
    if (original.fence != null && original.fence !== view.fence)
      throw new Error('LEGACY_RESERVE_RESULT_REQUIRED');
    const history = new Set(view.stateHistory.map((entry) => entry.state));
    if ((original.stateHistory || []).some((entry) => !history.has(entry.state)))
      throw new Error('LEGACY_STATE_HISTORY_REQUIRES_REVIEW');
  }
  if (name === 'queue_tickets' && original.createdAt) {
    const event = await connection
      .collection('outbox')
      .findOne(
        { aggregate_id: original.id, message_type: 'QueueTicketChanged' },
        { sort: { aggregate_version: 1 } },
      );
    if (!event || +new Date(event.occurred_at) !== +new Date(original.createdAt))
      throw new Error('LEGACY_QUEUE_ORDER_EVIDENCE_REQUIRED');
  }
  if (name === 'medication_holds') {
    const {
      hydrateMedicationHold,
    } = require('../services/pharmacy/src/services/medication-hold.repository');
    const view = await hydrateMedicationHold(connection, candidate);
    for (const key of [
      'requestId',
      'amountVnd',
      'snapshotHash',
      'fenceCounter',
      'reserveAttemptVersion',
      'cancellationId',
    ])
      if (original[key] != null && original[key] !== view[key])
        throw new Error('LEGACY_TECHNICAL_EVIDENCE_REQUIRED:' + name + ':' + key);
    if (
      original.paidEvidence &&
      EJSON.stringify(original.paidEvidence) !== EJSON.stringify(view.paidEvidence)
    )
      throw new Error('LEGACY_PAYMENT_RECEIPT_REQUIRED');
    if (original.fence != null && original.fence !== view.fence)
      throw new Error('LEGACY_RESERVE_RESULT_REQUIRED');
  }
  if (name === 'schedules' && (original.doctorUserId || original.departmentId)) {
    const {
      resolveDoctorMapping,
    } = require('../services/appointment/src/services/doctor-mapping.service');
    const mapping = await resolveDoctorMapping(connection, candidate.doctorId);
    if (
      original.doctorUserId !== mapping.doctorUserId ||
      original.departmentId !== mapping.departmentId
    )
      throw new Error('LEGACY_CATALOG_MAPPING_REQUIRES_REVIEW');
  }
}

// Writers must be stopped: validate every proposed row before the first change.
// Missing evidence aborts; this migration never synthesizes messages or payments.
async function migrateBusinessStorage(
  connection,
  { service, apply = false, writersStopped = false, backupDir } = {},
) {
  const { EJSON } = connection.base.mongo.BSON;
  if (!owners[service]) throw new Error('Unknown ERD owner.');
  if (apply && (!writersStopped || !backupDir))
    throw new Error('Apply requires stopped writers and an explicit local backup directory.');
  const changes = [];
  const report = [];
  for (const name of owners[service]) {
    let count = 0,
      changed = 0;
    const rows = await connection.collection(name).find({}, { promoteLongs: false }).toArray();
    for (const row of rows) {
      count++;
      const candidate = businessDocument(name, row, connection.base.mongo.BSON);
      if (!(await validDocument(connection, name, candidate)))
        throw new Error(
          'LEGACY_DATA_REQUIRES_REVIEW:' + name + ':' + String(row.id || row.patientId),
        );
      if (
        EJSON.stringify(row, { relaxed: false }) !== EJSON.stringify(candidate, { relaxed: false })
      ) {
        await verifyTechnicalSources(connection, name, row, candidate);
        changes.push({ name, original: row, candidate });
        changed++;
      }
    }
    report.push({ name, count, changed });
  }
  if (!apply) return { dryRun: true, report };
  const destination = path.resolve(backupDir);
  await fs.mkdir(destination, { recursive: true });
  const metadata = {
    service,
    database: connection.name,
    at: new Date().toISOString(),
    collections: {},
  };
  for (const name of owners[service]) {
    metadata.collections[name] = {
      options: (await connection.db.listCollections({ name }).next())?.options || {},
      indexes: await connection.collection(name).indexes(),
    };
    const rows = await connection.collection(name).find({}, { promoteLongs: false }).toArray();
    const serialized = EJSON.stringify(rows, { relaxed: false });
    const target = path.join(destination, name + '.json');
    await fs.writeFile(target, serialized, { encoding: 'utf8', flag: 'wx' });
    const expectedHash = crypto.createHash('sha256').update(serialized).digest('hex');
    const readbackHash = crypto
      .createHash('sha256')
      .update(await fs.readFile(target))
      .digest('hex');
    if (expectedHash !== readbackHash) throw new Error('BACKUP_VERIFICATION_FAILED');
    metadata.collections[name].sha256 = expectedHash;
  }
  await fs.writeFile(
    path.join(destination, 'manifest.json'),
    EJSON.stringify(metadata, { relaxed: false }),
    { encoding: 'utf8', flag: 'wx' },
  );
  const session = await connection.startSession();
  try {
    await session.withTransaction(async () => {
      for (const { name, original, candidate } of changes) {
        const current = await connection
          .collection(name)
          .findOne({ _id: original._id }, { session, promoteLongs: false });
        if (
          EJSON.stringify(current, { relaxed: false }) !==
          EJSON.stringify(original, { relaxed: false })
        )
          throw new Error('SOURCE_CHANGED_DURING_MIGRATION');
        await connection.collection(name).replaceOne({ _id: original._id }, candidate, { session });
      }
    });
  } finally {
    await session.endSession();
  }
  await installBusinessValidators(connection, service);
  return { dryRun: false, report, backupDir: destination };
}

module.exports = {
  owners,
  specification,
  businessDocument,
  validDocument,
  auditBusinessStorage,
  installBusinessValidators,
  migrateBusinessStorage,
};
