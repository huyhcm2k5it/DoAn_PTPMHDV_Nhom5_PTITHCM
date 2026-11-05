const amqplib = require('amqplib');
const { connectDatabase } = require('../src/configs/database.js');
const { publishPatientOutboxBatch } = require('../src/workers/outbox-publisher.worker.js');

async function main() {
  const connection = await connectDatabase(process.env.MONGODB_URI);
  const broker = await amqplib.connect(process.env.AMQP_URL || 'amqp://guest:guest@rabbitmq:5672/umc-care');
  const channel = await broker.createConfirmChannel();
  await channel.assertExchange('umc.events.patient.v1', 'topic', { durable: true });
  let stopping = false;
  const run = async () => {
    if (stopping) return;
    try { await publishPatientOutboxBatch({ connection, channel }); } catch (error) { console.error('patient outbox publish failed:', error.message); }
    setTimeout(run, Number(process.env.OUTBOX_POLL_MS || 1000)).unref();
  };
  run();
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: shutting down patient-worker`);
    await channel.close();
    await broker.close();
    await connection.close();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM').finally(() => process.exit(0)));
  process.on('SIGINT', () => shutdown('SIGINT').finally(() => process.exit(0)));
  console.log('patient-worker publishing PatientAccessChanged');
}

main().catch((error) => { console.error('patient-worker startup failed:', error.message); process.exitCode = 1; });
