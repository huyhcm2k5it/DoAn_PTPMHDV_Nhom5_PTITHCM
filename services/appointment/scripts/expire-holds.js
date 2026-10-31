const { connectDatabase } = require('../src/configs/database.js');
const { expireHolds } = require('../src/services/holds.service.js');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  const connection = await connectDatabase(process.env.MONGODB_URI);
  try {
    const expired = await expireHolds({
      connection,
      batchSize: Number(process.env.EXPIRE_BATCH_SIZE || 100),
    });
    console.log(JSON.stringify({ expired }));
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
