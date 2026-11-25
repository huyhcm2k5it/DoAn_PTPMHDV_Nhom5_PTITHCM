const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { migrateBusinessStorage, auditBusinessStorage } = require('./erd-storage');

async function restoreBusinessStorage(connection, { service, backupDir, writersStopped } = {}) {
  if (!writersStopped || !backupDir)
    throw new Error('Restore requires stopped writers and the explicit backup directory.');
  const { EJSON } = connection.base.mongo.BSON;
  const directory = path.resolve(backupDir);
  const manifest = EJSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.service !== service || manifest.database !== connection.name)
    throw new Error('Backup owner/database mismatch.');
  const documents = {};
  for (const [name, metadata] of Object.entries(manifest.collections)) {
    if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid backup collection name.');
    const bytes = await fs.readFile(path.join(directory, name + '.json'));
    if (
      !metadata.sha256 ||
      crypto.createHash('sha256').update(bytes).digest('hex') !== metadata.sha256
    )
      throw new Error('Backup checksum mismatch.');
    documents[name] = EJSON.parse(bytes.toString('utf8'));
  }
  for (const [name, metadata] of Object.entries(manifest.collections)) {
    await connection.db.command({
      collMod: name,
      validator: metadata.options.validator || {},
      validationLevel: metadata.options.validationLevel || 'strict',
      validationAction: metadata.options.validationAction || 'error',
    });
  }
  const session = await connection.startSession();
  try {
    await session.withTransaction(async () => {
      for (const [name, rows] of Object.entries(documents))
        for (const row of rows)
          await connection
            .collection(name)
            .replaceOne({ _id: row._id }, row, { session, upsert: true });
    });
  } finally {
    await session.endSession();
  }
  return {
    restored: true,
    collections: Object.fromEntries(
      Object.entries(documents).map(([name, rows]) => [name, rows.length]),
    ),
  };
}

async function runErdMigration(mongoose, service) {
  const args = process.argv.slice(2);
  const known = new Set(['--apply', '--writers-stopped', '--backup-dir', '--restore', '--audit']);
  const options = { service, apply: false, writersStopped: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!known.has(flag)) throw new Error('Unknown migration option.');
    if (flag === '--apply') options.apply = true;
    if (flag === '--writers-stopped') options.writersStopped = true;
    if (flag === '--audit') options.audit = true;
    if (['--backup-dir', '--restore'].includes(flag)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Migration directory is required.');
      options[flag === '--restore' ? 'restore' : 'backupDir'] = value;
    }
  }
  const uri = process.env.MONGODB_URI;
  if (!uri || decodeURIComponent(new URL(uri).pathname.slice(1)) !== service + '_db')
    throw new Error('MONGODB_URI must select the explicit owner database.');
  if (options.restore && !options.apply) throw new Error('Restore requires --apply.');
  const connection = await mongoose
    .createConnection(uri, {
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000,
      runtimeAdapters: { os: require('node:os') },
    })
    .asPromise();
  try {
    const report = options.restore
      ? await restoreBusinessStorage(connection, {
          service,
          backupDir: options.restore,
          writersStopped: options.writersStopped,
        })
      : options.audit
        ? await auditBusinessStorage(connection, service)
        : await migrateBusinessStorage(connection, options);
    console.log(JSON.stringify(report));
  } finally {
    await connection.close();
  }
}

module.exports = { runErdMigration, restoreBusinessStorage };
