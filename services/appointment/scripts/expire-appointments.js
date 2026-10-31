const { connectDatabase } = require('../src/configs/database.js');
const { expirePendingAppointments } = require('../src/workers/appointment-expiry.worker.js');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  const connection = await connectDatabase(process.env.MONGODB_URI);
  try {
    console.log(
      JSON.stringify({
        expired: await expirePendingAppointments({
          connection,
          batchSize: Number(process.env.EXPIRE_BATCH_SIZE || 100),
        }),
      }),
    );
  } finally {
    await connection.close();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { main };
