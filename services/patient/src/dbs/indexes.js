const { entity, installStorage, requiredFields, technicalStorage } = require('../../../../mongo/storage.js');

const patientStorage = [
  {
    ...entity('patients', [{ name: 'ix_patients_owner', key: { ownerUserId: 1 } }]),
    validator: requiredFields(['id', 'ownerUserId'], {
      id: { bsonType: 'string', minLength: 1 },
      ownerUserId: { bsonType: 'string', minLength: 1 },
    }),
  },
  entity('profile_audit', [{ name: 'ix_profile_audit_patient_at', key: { patientId: 1, at: -1 } }]),
  ...technicalStorage,
];

async function ensurePatientStorage(connection) { await installStorage(connection, patientStorage); }

module.exports = { patientStorage, ensurePatientStorage };
