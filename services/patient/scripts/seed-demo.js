const mongoose = require('mongoose');
const { ensurePatientStorage } = require('../src/dbs/indexes.js');
const { getPatientModel } = require('../src/models/patient.model.js');

const patients = [
  {
    id: '00000000-0000-4000-8000-000000000701',
    ownerUserId: '00000000-0000-4000-8000-000000000911',
    relation: 'SELF',
    fullName: 'Demo Patient A',
    birthDate: '1998-01-01',
    active: true,
    version: 1,
    policyVersion: 1,
  },
  {
    id: '00000000-0000-4000-8000-000000000702',
    ownerUserId: '00000000-0000-4000-8000-000000000912',
    relation: 'SELF',
    fullName: 'Demo Patient B',
    birthDate: '1997-02-02',
    active: true,
    version: 1,
    policyVersion: 1,
  },
];
async function seed({
  uri = process.env.MONGODB_URI,
  dryRun = process.argv.includes('--dry-run'),
} = {}) {
  if (dryRun) return patients;
  if (!uri) throw new Error('MONGODB_URI is required');
  const connection = await mongoose
    .createConnection(uri, { autoCreate: false, autoIndex: false })
    .asPromise();
  try {
    await ensurePatientStorage(connection);
    const Patient = getPatientModel(connection);
    for (const patient of patients)
      await Patient.replaceOne({ id: patient.id }, patient, { upsert: true });
    return patients;
  } finally {
    await connection.close();
  }
}
if (require.main === module)
  seed()
    .then(() => console.log('patient demo seed ready'))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { patients, seed };
