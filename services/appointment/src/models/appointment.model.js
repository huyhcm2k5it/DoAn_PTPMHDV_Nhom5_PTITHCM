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
function getHoldModel(connection) {
  if (connection.models.Hold) return connection.models.Hold;
  const schema = new connection.base.Schema({
    id: { type: String, required: true }, principalId: { type: String, required: true }, idempotencyKey: { type: String, required: true },
    patientId: { type: String, required: true }, slotId: { type: String, required: true }, doctorId: { type: String, required: true }, serviceId: { type: String, required: true },
    scheduleId: { type: String, required: true }, slotStartAt: { type: Date, required: true }, slotEndAt: { type: Date, required: true },
    status: { type: String, required: true, enum: ['HELD', 'CONSUMED', 'RELEASED', 'EXPIRED'] },
    expiresAt: { type: Date, required: true }, createdAt: { type: Date, required: true }, releasedAt: Date,
    priceSnapshot: { type: connection.base.Schema.Types.Mixed, default: null }, version: { type: Number, default: 1 },
  }, { collection: 'holds', versionKey: false, strict: 'throw' });
  schema.index({ principalId: 1, idempotencyKey: 1 }, { unique: true, sparse: true, name: 'uq_hold_principal_key' });
  schema.index({ status: 1, expiresAt: 1 }, { name: 'ix_hold_expiry' });
  return connection.model('Hold', schema);
}
function getAppointmentModel(connection) {
  if (connection.models.Appointment) return connection.models.Appointment;
  const schema = new connection.base.Schema({
    id: { type: String, required: true }, requestId: { type: String, required: true }, sourceRevision: { type: Number, required: true }, holdId: { type: String, required: true }, patientId: { type: String, required: true },
    principalId: { type: String, required: true }, slotId: { type: String, required: true }, scheduleId: { type: String, required: true },
    doctorId: { type: String, required: true }, serviceId: { type: String, required: true }, startAt: { type: Date, required: true }, endAt: { type: Date, required: true },
    state: { type: String, required: true, enum: ['PENDING_PAYMENT', 'SETTLEMENT_LOCKED', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'COMPLETED'] },
    chargeSync: { type: String, required: true, enum: ['PENDING', 'CREATED', 'REJECTED'] }, chargeId: String, chargeStatus: String, refundStatus: String,
    priceSnapshot: { type: connection.base.Schema.Types.Mixed, default: null }, paymentDueAt: Date, settlementId: String, fence: Number, version: { type: Number, default: 1 }, createdAt: { type: Date, required: true }, updatedAt: { type: Date, required: true },
  }, { collection: 'appointments', versionKey: false, strict: 'throw' });
  schema.index({ holdId: 1 }, { unique: true, name: 'uq_appointment_hold' });
  schema.index({ patientId: 1, startAt: 1 }, { name: 'ix_appointment_patient_start' });
  return connection.model('Appointment', schema);
}
function getPatientTimeLockModel(connection) {
  if (connection.models.PatientTimeLock) return connection.models.PatientTimeLock;
  const schema = new connection.base.Schema({ patientId: { type: String, required: true }, version: { type: Number, default: 1 }, updatedAt: { type: Date, required: true } }, { collection: 'patient_time_locks', versionKey: false, strict: 'throw' });
  schema.index({ patientId: 1 }, { unique: true, name: 'uq_patient_time_lock' });
  return connection.model('PatientTimeLock', schema);
}
function getIdempotencyModel(connection) {
  if (connection.models.IdempotencyRecord) return connection.models.IdempotencyRecord;
  const schema = new connection.base.Schema({ principal_id: { type: String, required: true }, route: { type: String, required: true }, key: { type: String, required: true }, request_hash: { type: String, required: true }, response: { type: connection.base.Schema.Types.Mixed, required: true }, created_at: { type: Date, required: true } }, { collection: 'idempotency_records', versionKey: false, strict: 'throw' });
  schema.index({ principal_id: 1, route: 1, key: 1 }, { unique: true, name: 'uq_idempotency_principal_route_key' });
  return connection.model('IdempotencyRecord', schema);
}
function getOutboxModel(connection) {
  if (connection.models.OutboxMessage) return connection.models.OutboxMessage;
  const schema = new connection.base.Schema({ message_id: { type: String, required: true }, message_kind: { type: String, required: true }, message_type: { type: String, required: true }, schema_version: { type: Number, required: true }, producer: { type: String, required: true }, aggregate_id: { type: String, required: true }, aggregate_version: { type: Number, required: true }, correlation_id: { type: String, required: true }, occurred_at: { type: Date, required: true }, payload: { type: connection.base.Schema.Types.Mixed, required: true }, published_at: Date, attempts: { type: Number, default: 0 } }, { collection: 'outbox', versionKey: false, strict: 'throw' });
  schema.index({ message_id: 1 }, { unique: true, name: 'uq_outbox_message' });
  return connection.model('OutboxMessage', schema);
}
function getInboxModel(connection) {
  if (connection.models.InboxMessage) return connection.models.InboxMessage;
  const schema = new connection.base.Schema({ message_id: { type: String, required: true }, consumer_name: { type: String, required: true }, received_at: { type: Date, required: true } }, { collection: 'inbox', versionKey: false, strict: 'throw' });
  schema.index({ message_id: 1, consumer_name: 1 }, { unique: true, name: 'uq_inbox_message_consumer' });
  return connection.model('InboxMessage', schema);
}
function getSettlementDecisionModel(connection) {
  if (connection.models.SettlementDecision) return connection.models.SettlementDecision;
  const schema = new connection.base.Schema({ id: { type: String, required: true }, settlementId: { type: String, required: true }, sourceId: { type: String, required: true }, sourceRevision: { type: Number, required: true }, decisionVersion: { type: Number, required: true }, state: { type: String, required: true, enum: ['SUCCEEDED', 'FAILED', 'UNKNOWN'] }, fence: Number, paymentId: String, reasonCode: String, createdAt: { type: Date, required: true } }, { collection: 'settlement_decisions', versionKey: false, strict: 'throw' });
  schema.index({ settlementId: 1, decisionVersion: 1 }, { unique: true, name: 'uq_settlement_decision_version' });
  return connection.model('SettlementDecision', schema);
}
module.exports = { getScheduleModel, getSlotModel, getHoldModel, getAppointmentModel, getPatientTimeLockModel, getIdempotencyModel, getOutboxModel, getInboxModel, getSettlementDecisionModel };
