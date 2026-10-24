function getScheduleModel(connection) {
  if (connection.models.Schedule) return connection.models.Schedule;
  const schema = new connection.base.Schema(
    {
      id: { type: String, required: true },
      doctorId: { type: String, required: true },
      serviceId: { type: String, required: true },
      room: String,
      startAt: { type: Date, required: true },
      endAt: { type: Date, required: true },
      capacityPerSlot: Number,
      status: { type: String, default: "OPEN" },
      slotMinutes: Number,
      version: Number,
    },
    { collection: "schedules", versionKey: false, strict: "throw" },
  );
  schema.index(
    { doctorId: 1, startAt: 1 },
    { name: "ix_schedules_doctor_start" },
  );
  return connection.model("Schedule", schema);
}
function getSlotModel(connection) {
  if (connection.models.Slot) return connection.models.Slot;
  const schema = new connection.base.Schema(
    {
      id: { type: String, required: true },
      scheduleId: { type: String, required: true },
      startAt: { type: Date, required: true },
      endAt: { type: Date, required: true },
      capacity: { type: Number, required: true },
      heldCount: { type: Number, required: true },
      confirmedCount: { type: Number, required: true },
    },
    { collection: "slots", versionKey: false, strict: "throw" },
  );
  schema.index(
    { scheduleId: 1, startAt: 1 },
    { unique: true, name: "uq_slot_schedule_start" },
  );
  return connection.model("Slot", schema);
}
module.exports = { getScheduleModel, getSlotModel };
