const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { mongoHarness } = require('./test-harness');
const { ensureAppointmentStorage } = require('../../services/appointment/src/dbs/indexes');
const {
  exportClinicalTickets,
} = require('../../services/appointment/scripts/export-clinical-tickets');
const schema = require('../../contracts/messages/clinical-ticket-snapshot.v1.schema.json');
const ajv = new Ajv();
addFormats(ajv);
const validate = ajv.compile(schema);
const h = mongoHarness(ensureAppointmentStorage);
function ticket(type = 'FIRST') {
  return {
    id: randomUUID(),
    appointmentId: randomUUID(),
    patientId: randomUUID(),
    doctorId: randomUUID(),
    doctorUserId: randomUUID(),
    departmentId: randomUUID(),
    appointmentDate: '2026-11-07',
    ticketType: type,
    returnRound: type === 'FIRST' ? 0 : 1,
    state: 'CALLED',
    version: 2,
    ...(type === 'RETURN' ? { visitId: randomUUID() } : {}),
  };
}
test('trusted ticket export matches provisional schema and leaves owner data unchanged', async () => {
  const rows = [ticket(), ticket('RETURN')];
  await h.connection.collection('queue_tickets').insertMany(rows);
  const result = await exportClinicalTickets({ connection: h.connection, date: '2026-11-07' });
  assert.equal(result.length, 2);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  assert.equal(await h.connection.collection('outbox').countDocuments(), 0);
  assert.equal(await h.connection.collection('queue_tickets').countDocuments(), 2);
});
test('export fails closed when doctor mapping is missing instead of inventing a grant', async () => {
  const row = ticket();
  delete row.doctorUserId;
  await h.connection.collection('queue_tickets').insertOne(row);
  await assert.rejects(
    exportClinicalTickets({ connection: h.connection, date: '2026-11-07' }),
    /Trusted ticket mapping missing/,
  );
});

test('owner slot and queue lookups use their business indexes', async () => {
  const row = ticket();
  row.state = 'WAITING';
  await h.connection.collection('queue_tickets').insertOne(row);
  await h.connection
    .collection('slots')
    .insertOne({
      id: 'slot-query',
      scheduleId: 'schedule-query',
      startAt: new Date(),
      endAt: new Date(Date.now() + 60000),
      capacity: 1,
      heldCount: 0,
      confirmedCount: 0,
    });
  const slot = await h.connection
    .collection('slots')
    .find({ id: 'slot-query' })
    .explain('queryPlanner');
  assert.match(JSON.stringify(slot.queryPlanner.winningPlan), /uq_id/);
  const queue = await h.connection
    .collection('queue_tickets')
    .find({ state: 'WAITING', ticketType: 'FIRST', doctorId: row.doctorId })
    .sort({ createdAt: 1 })
    .explain('queryPlanner');
  assert.match(JSON.stringify(queue.queryPlanner.winningPlan), /ix_queue_today_state/);
});
