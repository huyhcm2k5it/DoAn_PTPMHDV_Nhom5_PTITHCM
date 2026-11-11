const {
  entity,
  installStorage,
  requiredFields,
  technicalStorage,
} = require('../../../../mongo/storage.js');

const patientStorage = [
  {
    ...entity('patients', [
      { name: 'ix_patients_owner', key: { ownerUserId: 1 } },
    ]),
    validator: requiredFields(['id', 'ownerUserId'], {
      id: { bsonType: 'string', minLength: 1 },
      ownerUserId: { bsonType: 'string', minLength: 1 },
    }),
  },
  entity('profile_audit', [
    { name: 'ix_profile_audit_patient_at', key: { patientId: 1, at: -1 } },
  ]),
  {
    name: 'user_access_projection',
    indexes: [
      { name: 'uq_user_access_projection', key: { userId: 1 }, unique: true },
    ],
  },
  {
    name: 'retry_jobs',
    indexes: [
      { name: 'uq_retry_id', key: { id: 1 }, unique: true },
      {
        name: 'ix_retry_due',
        key: { consumerName: 1, state: 1, nextAttemptAt: 1, leaseUntil: 1 },
      },
    ],
  },
  {
    name: 'dead_letters',
    indexes: [{ name: 'uq_dead_letter', key: { id: 1 }, unique: true }],
  },
  ...technicalStorage,
];

async function ensurePatientStorage(connection) {
  await installStorage(connection, patientStorage);
}

module.exports = { patientStorage, ensurePatientStorage };
