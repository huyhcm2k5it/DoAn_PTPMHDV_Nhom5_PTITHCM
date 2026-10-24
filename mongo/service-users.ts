import type { MongoClient } from 'mongodb';

export const ownerDatabases = { patient: 'patient_db', appointment: 'appointment_db', pharmacy: 'pharmacy_db' } as const;
export type MongoOwner = keyof typeof ownerDatabases;

export async function provisionOwnerUser(client: MongoClient, owner: MongoOwner, password: string): Promise<void> {
  const database = ownerDatabases[owner];
  await client.db(database).command({
    createUser: `${owner}-service`, pwd: password,
    roles: [{ role: 'readWrite', db: database }],
  });
}
