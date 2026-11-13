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

test('owner enqueue publishes FIRST and RETURN snapshots via the canonical outbox', async () => {
  const rows = [ticket(), ticket('RETURN')];
  rows[1].state = 'IN_SERVICE';
  await h.connection.collection('queue_tickets').insertMany(rows);
  const result = await exportClinicalTickets({
    connection: h.connection,
    date: '2026-11-07',
    enqueue: true,
  });
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  const events = await h.connection
    .collection('outbox')
    .find({ message_type: 'QueueTicketChanged' })
    .toArray();
  assert.equal(events.length, 2);
  for (const event of events) {
    assert.equal(event.aggregate_id, event.payload.ticketId);
    assert.equal(event.aggregate_version, event.payload.version);
    assert.deepEqual(
      event.payload,
      result.find((snapshot) => snapshot.ticketId === event.aggregate_id),
    );
  }
});

test('owner slot and queue lookups use their business indexes', async () => {
  const row = ticket();
  row.state = 'WAITING';
  await h.connection.collection('queue_tickets').insertOne(row);
  await h.connection.collection('slots').insertOne({
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

const { checkInAppointment } = require('../../services/appointment/src/services/queue.service');
test('check-in rejects missing Clinical mapping before committing a ticket', async () => {
  const now = new Date('2026-11-13T02:00:00Z');
  const id = randomUUID();
  await h.connection.collection('appointments').insertOne({
    id,
    holdId: randomUUID(),
    createdAt: now,
    updatedAt: now,
    patientId: randomUUID(),
    doctorId: randomUUID(),
    state: 'CONFIRMED',
    chargeStatus: 'PAID',
    startAt: now,
    version: 1,
  });
  await assert.rejects(
    checkInAppointment({
      connection: h.connection,
      appointmentId: id,
      staffId: randomUUID(),
      idempotencyKey: randomUUID(),
      now,
    }),
    (error) => error.code === 'CLINICAL_MAPPING_UNAVAILABLE',
  );
  assert.equal((await h.connection.collection('appointments').findOne({ id })).state, 'CONFIRMED');
  assert.equal(await h.connection.collection('queue_tickets').countDocuments(), 0);
});
test('check-in commits the trusted Clinical ticket event atomically', async () => {
  const now = new Date('2026-11-13T02:00:00Z');
  const id = randomUUID();
  await h.connection.collection('appointments').insertOne({
    id,
    holdId: randomUUID(),
    createdAt: now,
    updatedAt: now,
    patientId: randomUUID(),
    doctorId: randomUUID(),
    doctorUserId: randomUUID(),
    departmentId: randomUUID(),
    state: 'CONFIRMED',
    chargeStatus: 'PAID',
    startAt: now,
    version: 1,
  });
  const result = await checkInAppointment({
    connection: h.connection,
    appointmentId: id,
    staffId: randomUUID(),
    idempotencyKey: randomUUID(),
    now,
  });
  const event = await h.connection
    .collection('outbox')
    .findOne({ message_type: 'QueueTicketChanged' });
  assert.equal(event.payload.ticketId, result.ticketId);
  assert.equal(event.payload.doctorUserId.length, 36);
});

test('Clinical ticket snapshots never coerce array IDs into trusted UUIDs', () => {
  const {
    clinicalTicketSnapshot,
  } = require('../../services/appointment/src/services/clinical-ticket-feed');
  const row = ticket();
  row.doctorUserId = [row.doctorUserId];
  assert.equal(clinicalTicketSnapshot(row), null);
});
