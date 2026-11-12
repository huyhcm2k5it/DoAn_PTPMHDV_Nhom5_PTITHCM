const { withMongoTransaction } = require('../../../mongo/transaction');
const { getQueueTicketModel } = require('../src/models/appointment.model');
const {
  clinicalTicketSnapshot,
  enqueueClinicalTicket,
} = require('../src/services/clinical-ticket-feed');

async function exportClinicalTickets({ connection, date, enqueue = false }) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
    new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date
  )
    throw new Error('Valid --date=YYYY-MM-DD is required.');
  return withMongoTransaction(connection, async (session) => {
    const rows = await getQueueTicketModel(connection)
      .find({ appointmentDate: date })
      .sort({ id: 1 })
      .limit(1001)
      .session(session)
      .lean();
    if (rows.length > 1000)
      throw new Error(
        'Snapshot limit exceeded; agree a partition with Clinical owner.',
      );
    const snapshots = [];
    for (const row of rows) {
      const snapshot = clinicalTicketSnapshot(row);
      if (!snapshot)
        throw new Error(
          'Trusted ticket mapping missing or invalid ticket state.',
        );
      snapshots.push(snapshot);
      if (enqueue)
        await enqueueClinicalTicket(connection, session, row, new Date());
    }
    return snapshots;
  });
}
if (require.main === module) {
  (async () => {
    const fs = require('node:fs'),
      path = require('node:path');
    const date = process.argv
      .find((arg) => arg.startsWith('--date='))
      ?.slice(7);
    if (!date) throw new Error('Supply --date=YYYY-MM-DD.');
    const enqueue = process.argv.includes('--enqueue');
    if (enqueue && !process.argv.includes('--apply'))
      throw new Error(
        'Add --apply only after reviewing the owner-verified ticket export.',
      );
    const connection = await require('../src/configs/database').connectDatabase(
      process.env.MONGODB_URI,
    );
    try {
      const rows = await exportClinicalTickets({ connection, date, enqueue });
      if (enqueue) {
        console.log(
          'Queued ' +
            rows.length +
            ' trusted ticket snapshots in Appointment outbox.',
        );
        return;
      }
      const directory = path.resolve(__dirname, '../../../.runtime/exports');
      fs.mkdirSync(directory, { recursive: true });
      const target = path.join(directory, 'clinical-tickets-' + date + '.json');
      fs.writeFileSync(target, JSON.stringify(rows, null, 2) + '\n', {
        flag: 'wx',
      });
      console.log(
        'Exported ' +
          rows.length +
          ' trusted ticket snapshots to local .runtime/exports.',
      );
    } finally {
      await connection.close();
    }
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { exportClinicalTickets };
