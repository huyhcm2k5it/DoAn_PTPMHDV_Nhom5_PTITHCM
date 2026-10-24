function getPatientModel(connection) {
  if (connection.models.Patient) return connection.models.Patient;
  const schema = new connection.base.Schema({
    id: { type: String, required: true }, ownerUserId: { type: String, required: true },
    relation: { type: String, required: true, enum: ['SELF', 'OTHER'] }, fullName: { type: String, required: true },
    birthDate: { type: String, required: true }, sex: String, bhytSelfDeclared: String, contactPhone: String, address: String,
    active: { type: Boolean, default: true }, version: { type: Number, default: 1 }, policyVersion: { type: Number, default: 1 }, createdAt: Date, updatedAt: Date,
  }, { collection: 'patients', versionKey: false, strict: 'throw' });
  schema.index({ ownerUserId: 1 }, { name: 'ix_patients_owner' });
  return connection.model('Patient', schema);
}
module.exports = { getPatientModel };