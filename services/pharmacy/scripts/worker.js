const amqp = require('amqplib');
const { connectDatabase } = require('../src/configs/database');
const { startPharmacyWorker } = require('../src/workers/amqp-runtime');
const {
  publishPharmacyOutboxBatch,
} = require('../src/workers/outbox-publisher.worker');
const {
  expireMedicationHolds,
} = require('../src/services/medication-holds.service');
const {
  queryUnresolvedSettlements,
} = require('../src/services/settlement.service');
const { startBackgroundJobs } = require('../../../mongo/background-jobs');
async function main() {
  const connection = await connectDatabase(process.env.MONGODB_URI);
  const worker = await startPharmacyWorker({
    connection,
    connect: amqp.connect,
    amqpUrl: process.env.AMQP_URL,
  });
  const jobs = startBackgroundJobs({
    intervalMs: Number(process.env.OUTBOX_POLL_MS || 1000),
    jobs: [
      () => publishPharmacyOutboxBatch({ connection, channel: worker.channel }),
      () => expireMedicationHolds({ connection }),
      () => queryUnresolvedSettlements({ connection }),
    ],
    onError: (error) =>
      console.error('pharmacy job failed:', error.code || error.name),
  });
  let closing = false;
  const close = async (code) => {
    if (closing) return;
    closing = true;
    await jobs.close();
    try {
      await worker.close();
    } catch {
      /* broker may already be closed */
    }
    await connection.close();
    process.exitCode = code;
  };
  process.once('SIGINT', () => close(0));
  process.once('SIGTERM', () => close(0));
  worker.broker.once('close', () => close(closing ? 0 : 1));
  console.log('pharmacy-worker ready');
}
main().catch((error) => {
  console.error('pharmacy worker startup failed:', error.code || error.name);
  process.exit(1);
});
