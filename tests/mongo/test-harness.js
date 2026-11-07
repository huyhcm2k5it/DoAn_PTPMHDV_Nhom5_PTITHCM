const { before, after, beforeEach } = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

function mongoHarness(ensureStorage, dbName = 'pharmacy_db') {
  const harness = {};
  let server;
  before(async () => {
    server = await MongoMemoryReplSet.create({
      binary: { version: '8.0.16' },
      replSet: { count: 1 },
    });
    harness.connection = await mongoose.createConnection(server.getUri(), {
      dbName, autoCreate: false, autoIndex: false,
      runtimeAdapters: { os: require('node:os') },
    }).asPromise();
    if (ensureStorage) await ensureStorage(harness.connection);
  }, { timeout: 120000 });
  beforeEach(async () => {
    const db = harness.connection.db;
    for (const { name } of await db.listCollections().toArray()) {
      await db.collection(name).deleteMany({});
    }
  });
  after(async () => {
    await harness.connection?.close();
    await server?.stop();
  });
  return harness;
}

module.exports = { mongoHarness };
