const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const snapshot = require('../../mongo/erd-business-validators.json');
const source = fs.readFileSync(path.join(root, snapshot.source), 'utf8').replace(/\r\n/g, '\n');
assert.equal(
  crypto.createHash('sha256').update(source).digest('hex'),
  snapshot.sourceSHA256,
  'ERD changed: review and regenerate the validator snapshot.',
);
const tables = new Map(
  [...source.matchAll(/^Table (\w+) \{\n([\s\S]*?)^\}/gm)].map((m) => [m[1], m[2]]),
);
for (const [name, validator] of Object.entries(snapshot.validators)) {
  const body = tables.get(name);
  assert.ok(body, 'ERD table missing: ' + name);
  const fields = [...body.matchAll(/^  (\w+) ([\w()[\]]+)(?:\s+\[(.*)\])?\s*$/gm)];
  const schema = validator.$jsonSchema || validator.$and[0].$jsonSchema;
  assert.deepEqual(
    Object.keys(schema.properties)
      .filter((key) => key !== '_id')
      .sort(),
    fields.map((m) => m[1]).sort(),
    'Validator field mismatch: ' + name,
  );
  const required = fields
    .filter((m) => !(m[3]?.includes('null') && !m[3]?.includes('not null')))
    .map((m) => m[1])
    .sort();
  assert.deepEqual([...schema.required].sort(), required, 'Required field mismatch: ' + name);
}
const definitions = [
  ['services/patient/src/models/patient.model.js', 'Patient', 'patients'],
  ...[
    ['Schedule', 'schedules'],
    ['Slot', 'slots'],
    ['Hold', 'holds'],
    ['Appointment', 'appointments'],
    ['QueueTicket', 'queue_tickets'],
    ['PatientTimeLock', 'patient_time_locks'],
  ].map(([model, collection]) => [
    'services/appointment/src/models/appointment.model.js',
    model,
    collection,
  ]),
];
for (const [file, model, collection] of definitions) {
  const text = fs
    .readFileSync(path.join(root, file), 'utf8')
    .split('function get' + model + 'Model')[1]
    .split('\nfunction ')[0];
  const actual = [...text.matchAll(/^      (\w+):/gm)].map((m) => m[1]).sort();
  const validator = snapshot.validators[collection],
    schema = validator.$jsonSchema || validator.$and[0].$jsonSchema;
  assert.deepEqual(
    actual,
    Object.keys(schema.properties)
      .filter((key) => key !== '_id')
      .sort(),
    'Mongoose fields drifted: ' + collection,
  );
}
console.log(
  'ERD check passed: 13 business collection validators and 7 Mongoose models match the Markdown field lists.',
);
