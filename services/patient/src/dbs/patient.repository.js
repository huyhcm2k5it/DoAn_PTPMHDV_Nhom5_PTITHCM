function createPatientsRepository(Patient) {
  return {
    async listOwned(ownerUserId, { skip, limit }) {
      const filter = { ownerUserId, active: { $ne: false } };
      const [items, total] = await Promise.all([
        Patient.find(filter)
          .sort({ createdAt: -1, id: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Patient.countDocuments(filter),
      ]);
      return { items: items.map(({ _id, ...patient }) => patient), total };
    },
    async findById(patientId) {
      const patient = await Patient.findOne({
        id: patientId,
        active: { $ne: false },
      }).lean();
      if (!patient) return null;
      const { _id, ...data } = patient;
      return data;
    },

    async findOwned(patientId, ownerUserId) {
      const patient = await Patient.findOne({
        id: patientId,
        ownerUserId,
        active: { $ne: false },
      }).lean();
      if (!patient) return null;
      const { _id, ...data } = patient;
      return data;
    },

    async search(query, { skip, limit }) {
      const pattern = new RegExp(
        query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      const filter = {
        active: { $ne: false },
        $or: [
          { id: pattern },
          { fullName: pattern },
          { contactPhone: pattern },
        ],
      };
      const [items, total] = await Promise.all([
        Patient.find(filter)
          .sort({ fullName: 1, id: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Patient.countDocuments(filter),
      ]);
      return {
        items: items.map((item) => {
          const { _id, ...data } = item;
          return data;
        }),
        total,
      };
    },
  };
}
module.exports = { createPatientsRepository };
