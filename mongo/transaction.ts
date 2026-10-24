import type { MongoClient, ClientSession } from 'mongodb';

export async function withMongoTransaction<T>(client: MongoClient, work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = client.startSession();
  try {
    return await session.withTransaction(() => work(session), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
      maxCommitTimeMS: 5000,
      timeoutMS: 15000,
    });
  }
  finally { await session.endSession(); }
}
