import type { Db, Document, IndexDescription } from 'mongodb';

export interface CollectionStorage {
  name: string;
  validator?: Document;
  indexes: IndexDescription[];
}

/** Bootstrap collections; incompatible existing options require an explicit migration. */
export async function installStorage(db: Db, collections: readonly CollectionStorage[]): Promise<void> {
  for (const collection of collections) {
    await db.createCollection(collection.name, {
      ...(collection.validator ? { validator: collection.validator, validationLevel: 'strict', validationAction: 'error' } : {}),
    });
    if (collection.indexes.length) await db.collection(collection.name).createIndexes(collection.indexes);
  }
}

export function requiredFields(required: string[], properties: Document = {}, constraint?: Document): Document {
  const identity = required.includes('id') ? { id: { bsonType: 'string', minLength: 1 } } : {};
  const schema = { $jsonSchema: { bsonType: 'object', required, properties: { ...properties, ...identity } } };
  return constraint ? { $and: [schema, constraint] } : schema;
}

export function entity(name: string, indexes: IndexDescription[] = [], extraRequired: string[] = []): CollectionStorage {
  return {
    name,
    validator: requiredFields(['id', ...extraRequired], { id: { bsonType: 'string', minLength: 1 } }),
    indexes: [{ name: 'uq_id', key: { id: 1 }, unique: true }, ...indexes],
  };
}

/** Technical names/keys follow ERD part 2; expiry cleanup needs its own retention policy. */
export const technicalStorage: readonly CollectionStorage[] = [
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
