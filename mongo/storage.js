

/** Bootstrap collections; incompatible existing options require an explicit migration. */
async function installStorage(connection, collections) {
  for (const collection of collections) {
    await connection.createCollection(collection.name, {
      ...(collection.validator ? { validator: collection.validator, validationLevel: 'strict', validationAction: 'error' } : {}),
    });
    if (collection.indexes.length) await connection.collection(collection.name).createIndexes(collection.indexes);
  }
}

function requiredFields(required, properties = {}, constraint) {
  const identity = required.includes('id') ? { id: { bsonType: 'string', minLength: 1 } } : {};
  const schema = { $jsonSchema: { bsonType: 'object', required, properties: { ...properties, ...identity } } };
  return constraint ? { $and: [schema, constraint] } : schema;
}

function entity(name, indexes = [], extraRequired = []) {
  return {
    name,
    validator: requiredFields(['id', ...extraRequired], { id: { bsonType: 'string', minLength: 1 } }),
    indexes: [{ name: 'uq_id', key: { id: 1 }, unique: true }, ...indexes],
  };
}

/** Technical names/keys follow ERD part 2; expiry cleanup needs its own retention policy. */
const technicalStorage = [
  { name: 'outbox', validator: requiredFields(['message_id']), indexes: [
    { name: 'uq_outbox_message', key: { message_id: 1 }, unique: true },
  ] },
  { name: 'inbox', validator: requiredFields(['message_id', 'consumer_name']), indexes: [
    { name: 'uq_inbox_message_consumer', key: { message_id: 1, consumer_name: 1 }, unique: true },
  ] },
  { name: 'idempotency_records', validator: requiredFields(['principal_id', 'route', 'key', 'request_hash']), indexes: [
    { name: 'uq_idempotency_principal_route_key', key: { principal_id: 1, route: 1, key: 1 }, unique: true },
  ] },
];

module.exports = { installStorage, requiredFields, entity, technicalStorage };
