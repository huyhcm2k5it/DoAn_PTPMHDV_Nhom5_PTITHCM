const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const mongoose = require('../../services/patient/node_modules/mongoose');
const { buildDataset } = require('./demo-dataset');
const {
  ensurePatientStorage,
} = require('../../services/patient/src/dbs/indexes');
const {
  ensureAppointmentStorage,
} = require('../../services/appointment/src/dbs/indexes');
const {
  ensurePharmacyStorage,
} = require('../../services/pharmacy/src/dbs/indexes');

const TARGETS = {
  patient: {
    key: 'PATIENT_MONGO_URI',
    host: 'cluster0.8a2ahrj.mongodb.net',
    database: 'patient_db',
    bootstrap: ensurePatientStorage,
  },
  appointment: {
    key: 'APPOINTMENT_MONGO_URI',
    host: 'cluster0.jmwxgbh.mongodb.net',
    database: 'appointment_db',
    bootstrap: ensureAppointmentStorage,
  },
  pharmacy: {
    key: 'PHARMACY_MONGO_URI',
    host: 'cluster0.qbu6p35.mongodb.net',
    database: 'pharmacy_db',
    bootstrap: ensurePharmacyStorage,
  },
};

function validateTargets(env) {
  return Object.entries(TARGETS).map(([owner, target]) => {
    let uri;
    try {
      uri = new URL(env[target.key]);
    } catch {
      throw new Error(`${target.key}: missing or invalid URI.`);
    }
    if (uri.protocol !== 'mongodb+srv:' || uri.hostname !== target.host)
      throw new Error(`${owner}: unapproved host or protocol.`);
    if (decodeURIComponent(uri.pathname.slice(1)) !== target.database)
      throw new Error(`${owner}: wrong database.`);
    if (!uri.username || !uri.password)
      throw new Error(`${owner}: credentials are required.`);
    return { owner, ...target, uri: env[target.key] };
  });
}

function readEnv(file) {
  const env = {};
  for (const line of fs
    .readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    )
      value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}

function keyOf(name, row) {
  return name === 'catalog_projection'
    ? { entityKey: row.entityKey }
    : { id: row.id };
}

async function insertOnly(collection, name, rows) {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = rows.slice(offset, offset + 500);
    const result = await collection.bulkWrite(
      batch.map((row) => ({
        updateOne: {
          filter: keyOf(name, row),
          update: { $setOnInsert: row },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    if (result.modifiedCount !== 0)
      throw new Error('Insert-only seed unexpectedly modified existing data.');
    inserted += result.upsertedCount;
  }
  return inserted;
}

async function verifyCollection(collection, name, rows) {
  const field = name === 'catalog_projection' ? 'entityKey' : 'id';
  let present = 0;
  for (let offset = 0; offset < rows.length; offset += 500) {
    present += await collection.countDocuments({
      [field]: {
        $in: rows.slice(offset, offset + 500).map((row) => row[field]),
      },
    });
  }
  if (present !== rows.length)
    throw new Error(
      `${name}: seed verification failed (${present}/${rows.length}).`,
    );
  return present;
}

async function applyDataset(connections, data, onProgress = () => {}) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
  // Validate all owner manifests before creating or inserting any business rows.
  for (const owner of Object.keys(TARGETS)) {
    const previous = await connections[owner]
      .collection('demo_seed_runs')
      .findOne({ id: data.batchId });
    if (previous && previous.fingerprint !== fingerprint)
      throw new Error(
        `${owner}: batch configuration differs; use the original parameters or a new batch id.`,
      );
  }
  const settled = await Promise.allSettled(
    Object.entries(TARGETS).map(async ([owner, target]) => {
      const connection = connections[owner];
      await target.bootstrap(connection);
      const manifest = connection.collection('demo_seed_runs');
      await manifest.createIndex(
        { id: 1 },
        { unique: true, name: 'uq_demo_seed_run' },
      );
      await manifest.updateOne(
        { id: data.batchId, fingerprint },
        {
          $setOnInsert: {
            id: data.batchId,
            fingerprint,
            config: data.config,
            source: 'DEMO_FIXTURE',
            status: 'APPLYING',
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
      const report = { owner, inserted: 0, collections: {} };
      for (const [name, rows] of Object.entries(data.collections[owner])) {
        const collection = connection.collection(name);
        if (name === 'demo_reference_data')
          await collection.createIndex(
            { id: 1 },
            { unique: true, name: 'uq_demo_reference' },
          );
        const before = await collection.countDocuments();
        const inserted = await insertOnly(collection, name, rows);
        const verified = await verifyCollection(collection, name, rows);
        report.inserted += inserted;
        report.collections[name] = {
          before,
          expected: rows.length,
          inserted,
          verified,
          total: await collection.countDocuments(),
        };
        onProgress({ owner, collection: name, inserted, verified });
      }
      await manifest.updateOne(
        { id: data.batchId, fingerprint },
        {
          $set: {
            status: 'COMPLETE',
            counts: report.collections,
            completedAt: new Date(),
          },
        },
      );
      return report;
    }),
  );
  const failures = settled
    .map((result, index) => ({ result, owner: Object.keys(TARGETS)[index] }))
    .filter((item) => item.result.status === 'rejected');
  if (failures.length) {
    const first = failures[0];
    const error = new Error(
      `${first.owner}: seed stopped; retained partial inserts can be resumed. ${first.result.reason.message}`,
    );
    error.code = first.result.reason.code;
    throw error;
  }
  const owners = settled.map((result) => result.value);
  return {
    batchId: data.batchId,
    fingerprint,
    inserted: owners.reduce((total, owner) => total + owner.inserted, 0),
    owners,
    examples: data.examples,
  };
}

function optionsFromArgs(argv) {
  const values = {};
  const known = new Set([
    '--apply',
    '--dry-run',
    '--env-file',
    '--start-date',
    '--batch-id',
    '--report-file',
    '--patient-count',
    '--doctor-count',
    '--days',
    '--medicine-count',
  ]);
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!known.has(key)) throw new Error(`Unknown option ${key}`);
    if (key === '--apply' || key === '--dry-run') {
      values[key] = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for ${key}`);
    values[key] = value;
  }
  if (values['--apply'] && values['--dry-run'])
    throw new Error('Choose --apply or --dry-run.');
  return values;
}

async function main() {
  const args = optionsFromArgs(process.argv.slice(2));
  const options = { startDate: args['--start-date'] };
  for (const [flag, key] of [
    ['--patient-count', 'patientCount'],
    ['--doctor-count', 'doctorCount'],
    ['--days', 'days'],
    ['--medicine-count', 'medicineCount'],
  ]) {
    if (args[flag]) options[key] = Number(args[flag]);
  }
  if (args['--batch-id']) options.batchId = args['--batch-id'];
  const data = buildDataset(options);
  if (!args['--apply']) {
    console.log(
      JSON.stringify(
        {
          mode: 'DRY_RUN',
          config: data.config,
          counts: Object.fromEntries(
            Object.entries(data.collections).map(([owner, collections]) => [
              owner,
              Object.fromEntries(
                Object.entries(collections).map(([name, rows]) => [
                  name,
                  rows.length,
                ]),
              ),
            ]),
          ),
          examples: data.examples,
        },
        null,
        2,
      ),
    );
    return;
  }
  const root = path.resolve(__dirname, '../..');
  const env = readEnv(path.resolve(root, args['--env-file'] || 'env/quan.env'));
  const targets = validateTargets(env);
  const connections = {};
  try {
    for (const target of targets) {
      connections[target.owner] = await mongoose
        .createConnection(target.uri, {
          autoCreate: false,
          autoIndex: false,
          serverSelectionTimeoutMS: 15000,
          connectTimeoutMS: 10000,
          appName: 'UMCCareDemoSeeder',
          runtimeAdapters: { os: require('node:os') },
        })
        .asPromise();
    }
    const report = await applyDataset(connections, data, (progress) =>
      console.log(JSON.stringify(progress)),
    );
    if (args['--report-file']) {
      const output = path.resolve(args['--report-file']);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    }
    console.log(
      JSON.stringify({
        batchId: report.batchId,
        inserted: report.inserted,
        status: 'VERIFIED',
      }),
    );
  } finally {
    await Promise.all(
      Object.values(connections).map((connection) => connection.close()),
    );
  }
}

if (require.main === module)
  main().catch((error) => {
    // Driver errors may contain a URI; print only the category/code to keep credentials private.
    console.error(
      JSON.stringify({
        status: 'FAILED',
        errorType: error.name,
        code: error.code || 'SEED_ERROR',
        message: String(error.message).replace(
          /mongodb(?:\+srv)?:\/\/[^\s]+/g,
          '[REDACTED_URI]',
        ),
      }),
    );
    process.exitCode = 1;
  });
module.exports = {
  validateTargets,
  readEnv,
  applyDataset,
  insertOnly,
  verifyCollection,
};
