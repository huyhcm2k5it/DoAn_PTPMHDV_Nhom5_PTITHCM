const { connectDatabase } = require('../src/configs/database.js');
const { startAppointmentWorker } = require('../src/workers/amqp-runtime.js');
const {
  publishOutboxBatch,
} = require('../src/workers/outbox-publisher.worker.js');
const {
  expirePendingAppointments,
} = require('../src/workers/appointment-expiry.worker.js');
const { expireHolds } = require('../src/services/holds.service.js');
const { startBackgroundJobs } = require('../../../mongo/background-jobs');

async function main() {
  const connection = await connectDatabase(process.env.MONGODB_URI);
  const worker = await startAppointmentWorker({ connection });
  const jobs = startBackgroundJobs({
    intervalMs: Number(process.env.OUTBOX_POLL_MS || 1000),
    jobs: [
      () => publishOutboxBatch({ connection, channel: worker.channel }),
      () => expireHolds({ connection }),
      () => expirePendingAppointments({ connection }),
    ],
    onError: (error) =>
      console.error(
        'appointment background job failed:',
        error.code || error.name,
      ),
  });
  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: shutting down appointment-worker`);
    await jobs.close();
    await worker.close();
    await connection.close();
  }
  process.on('SIGTERM', () =>
    shutdown('SIGTERM').finally(() => process.exit(0)),
  );
  process.on('SIGINT', () => shutdown('SIGINT').finally(() => process.exit(0)));
  worker.broker.once('close', () => {
    if (!stopping) shutdown('BROKER_CLOSED').finally(() => process.exit(1));
  });
  console.log(`appointment-worker consuming ${worker.queues.join(', ')}`);
}

main().catch((error) => {
  console.error('appointment-worker startup failed:', error.message);
  process.exitCode = 1;
});
