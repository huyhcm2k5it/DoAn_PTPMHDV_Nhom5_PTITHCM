const PATIENT_SEX = ['MALE', 'FEMALE', 'OTHER', 'UNKNOWN'];

function getPatientModel(connection) {
  if (connection.models.Patient) return connection.models.Patient;
  const schema = new connection.base.Schema(
    {
      id: { type: String, required: true },
      ownerUserId: { type: String, required: true },
      relation: { type: String, required: true, enum: ['SELF', 'OTHER'] },
      fullName: { type: String, required: true },
      birthDate: { type: Date, required: true },
      sex: { type: String, enum: PATIENT_SEX },
      bhytSelfDeclared: String,
      contactPhone: String,
      address: String,
      active: { type: Boolean, default: true },
      version: { type: Number, default: 1 },
      policyVersion: { type: Number, default: 1 },
      createdAt: Date,
      updatedAt: Date,
    },
    { collection: 'patients', versionKey: false, strict: 'throw' },
  );
  const { patientStorage } = require('../dbs/indexes.js');
  for (const { key, ...options } of patientStorage.find(
    (item) => item.name === 'patients',
  ).indexes)
    schema.index(key, options);
  return connection.model('Patient', schema);
}
module.exports = { getPatientModel, PATIENT_SEX };
