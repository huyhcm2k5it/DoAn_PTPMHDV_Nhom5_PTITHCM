const amqp = require('amqplib');
const { connectDatabase } = require('../src/configs/database');
const { startPatientWorker } = require('../src/workers/amqp-runtime');
const {
  publishPatientOutboxBatch,
} = require('../src/workers/outbox-publisher.worker');
const { startBackgroundJobs } = require('../../../mongo/background-jobs');

async function main() {
  const connection = await connectDatabase(process.env.MONGODB_URI);
  let worker;
  try {
    worker = await startPatientWorker({
      connection,
      connect: amqp.connect,
      amqpUrl: process.env.AMQP_URL,
    });
  } catch (error) {
    await connection.close();
    throw error;
  }
  const jobs = startBackgroundJobs({
    intervalMs: Number(process.env.OUTBOX_POLL_MS || 1000),
    jobs: [
      () => publishPatientOutboxBatch({ connection, channel: worker.channel }),
    ],
    onError: (error) =>
      console.error('patient outbox publish failed:', error.code || error.name),
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
  console.log(
    'patient-worker consuming IdentityAccessChanged and publishing PatientAccessChanged',
  );
}
main().catch((error) => {
  console.error('patient-worker startup failed:', error.code || error.name);
  process.exitCode = 1;
});
