const { connectDatabase } = require('../src/configs/database.js');
const { startAppointmentWorker } = require('../src/workers/amqp-runtime.js');

async function main() {
  const connection = await connectDatabase(process.env.MONGODB_URI);
  const worker = await startAppointmentWorker({ connection });
  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: shutting down appointment-worker`);
    await worker.close();
    await connection.close();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM').finally(() => process.exit(0)));
  process.on('SIGINT', () => shutdown('SIGINT').finally(() => process.exit(0)));
  console.log(`appointment-worker consuming ${worker.queues.join(', ')}`);
}

main().catch((error) => {
  console.error('appointment-worker startup failed:', error.message);
  process.exitCode = 1;
});
