const { createApp } = require('./app.js');
const { connectDatabase } = require('./configs/database.js');
async function main() {
  const connection = await connectDatabase(process.env.MONGODB_URI);
  const app = createApp({ connection });
  const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0');
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return; shuttingDown = true;
    console.log(signal + ': shutting down appointment-service');
    server.close(async (error) => { await connection.close(); process.exitCode = error ? 1 : 0; });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
}
main().catch((error) => { console.error('appointment-service startup failed:', error.message); process.exitCode = 1; });