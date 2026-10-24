function createPatientsRepository(Patient) {
  return {
    async listOwned(ownerUserId, { skip, limit }) {
      const filter = { ownerUserId, active: { $ne: false } };
      const [items, total] = await Promise.all([Patient.find(filter).sort({ createdAt: -1, id: 1 }).skip(skip).limit(limit).lean(), Patient.countDocuments(filter)]);
      return { items: items.map(({ _id, ...patient }) => patient), total };
    },
    async findById(patientId) {
      const patient = await Patient.findOne({ id: patientId, active: { $ne: false } }).lean();
      if (!patient) return null;
      const { _id, ...data } = patient;
      return data;
    },

    async findOwned(patientId, ownerUserId) {
      const patient = await Patient.findOne({ id: patientId, ownerUserId, active: { $ne: false } }).lean();
      if (!patient) return null;
      const { _id, ...data } = patient;
      return data;
    },
  };
}
module.exports = { createPatientsRepository };