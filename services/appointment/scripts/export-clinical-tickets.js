const { withMongoTransaction } = require('../../../mongo/transaction');
const { getQueueTicketModel } = require('../src/models/appointment.model');
async function exportClinicalTickets({ connection, date }) {
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
      throw new Error('Snapshot limit exceeded; agree a partition with Clinical owner.');
    return rows.map((row) => {
      const result = { ticketId: row.id };
      for (const key of [
        'appointmentId',
        'patientId',
        'doctorId',
        'doctorUserId',
        'departmentId',
        'ticketType',
        'state',
        'version',
      ])
        result[key] = row[key];
      if (row.ticketType === 'RETURN') result.visitId = row.visitId;
      for (const key of [
        'ticketId',
        'appointmentId',
        'patientId',
        'doctorId',
        'doctorUserId',
        'departmentId',
        ...(row.ticketType === 'RETURN' ? ['visitId'] : []),
      ]) {
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            result[key] || '',
          )
        )
          throw new Error('Trusted ticket mapping missing: ' + key);
      }
      if (
        !['FIRST', 'RETURN'].includes(result.ticketType) ||
        !['WAITING', 'CALLED', 'CLAIMED', 'NO_SHOW', 'DONE'].includes(result.state) ||
        !Number.isSafeInteger(result.version) ||
        result.version < 1
      )
        throw new Error('Invalid ticket snapshot.');
      return result;
    });
  });
}
if (require.main === module) {
  (async () => {
    const fs = require('node:fs'),
      path = require('node:path');
    const date = process.argv.find((arg) => arg.startsWith('--date='))?.slice(7);
    if (!date) throw new Error('Supply --date=YYYY-MM-DD.');
    const connection = await require('../src/configs/database').connectDatabase(
      process.env.MONGODB_URI,
    );
    try {
      const rows = await exportClinicalTickets({ connection, date });
      const directory = path.resolve(__dirname, '../../../.runtime/exports');
      fs.mkdirSync(directory, { recursive: true });
      const target = path.join(directory, 'clinical-tickets-' + date + '.json');
      fs.writeFileSync(target, JSON.stringify(rows, null, 2) + '\n', { flag: 'wx' });
      console.log(
        'Exported ' + rows.length + ' trusted ticket snapshots to local .runtime/exports.',
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
