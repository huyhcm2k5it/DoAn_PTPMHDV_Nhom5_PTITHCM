const test = require('node:test');
const assert = require('node:assert/strict');
const { mongoHarness } = require('./test-harness');
const { installStorage, requiredFields } = require('../../mongo/storage');

const h = mongoHarness(undefined, 'storage_compat_test');

test('bootstrap preserves a legacy validator and still installs the new index', async () => {
  const name = 'profile_audit';
  const legacy = requiredFields(['id']);
  const current = requiredFields(['id'], {
    changedFields: { bsonType: 'array', items: { bsonType: 'string' } },
  });
  if (!(await h.connection.db.listCollections({ name }).hasNext()))
    await h.connection.createCollection(name, { validator: legacy });
  const collection = h.connection.collection(name);
  await collection.insertOne({ id: 'legacy-audit' });
  const spec = [
    {
      name,
      validator: current,
      indexes: [{ name: 'uq_storage_audit_id', key: { id: 1 }, unique: true }],
    },
  ];

  await installStorage(h.connection, spec);
  await installStorage(h.connection, spec);

  const [metadata] = await h.connection.db.listCollections({ name }).toArray();
  assert.deepEqual(metadata.options.validator, legacy);
  assert.equal(await collection.countDocuments({ id: 'legacy-audit' }), 1);
  assert.equal(
    (await collection.indexes()).find((index) => index.name === 'uq_storage_audit_id').unique,
    true,
  );
  await assert.rejects(collection.insertOne({ id: 'legacy-audit' }), { code: 11000 });
});

test('bootstrap propagates create failures other than an existing namespace', async () => {
  const denied = Object.assign(new Error('Unauthorized'), { code: 13 });
  const connection = {
    createCollection: async () => {
      throw denied;
    },
  };
  await assert.rejects(
    installStorage(connection, [{ name: 'profile_audit', indexes: [] }]),
    denied,
  );
});
