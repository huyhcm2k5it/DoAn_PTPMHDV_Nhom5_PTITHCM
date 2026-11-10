const { withMongoTransaction } = require('../../../mongo/transaction');
async function migrateLegacyPharmacy(connection, { dryRun = true } = {}) {
  const holds = connection.collection('medication_holds');
  const legacy = await holds.find({ attemptNo: { $exists: false } }).toArray();
  const active = legacy.filter(
    (row) => !['RELEASED', 'EXPIRED'].includes(row.status),
  );
  if (!dryRun && active.length)
    throw new Error(
      'LEGACY_DATA_REQUIRES_REVIEW: active holds need verified stock/payment evidence.',
    );
  if (!dryRun)
    await withMongoTransaction(connection, async (session) => {
      for (const row of legacy)
        await holds.updateOne(
          {
            id: row.id,
            attemptNo: { $exists: false },
            status: { $in: ['RELEASED', 'EXPIRED'] },
          },
          {
            $set: {
              attemptNo: 1,
              version: row.version || 1,
              attemptHistory: row.attemptHistory || [],
            },
          },
          { session },
        );
    });
  return { legacy: legacy.length, activeRequiresReview: active.length, dryRun };
}
if (require.main === module) {
  const { connectDatabase } = require('../src/configs/database');
  (async () => {
    const connection = await connectDatabase(process.env.MONGODB_URI);
    try {
      console.log(
        JSON.stringify(
          await migrateLegacyPharmacy(connection, {
            dryRun: !process.argv.includes('--apply'),
          }),
        ),
      );
    } finally {
      await connection.close();
    }
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { migrateLegacyPharmacy };
