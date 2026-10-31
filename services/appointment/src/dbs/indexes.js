const {
  entity,
  installStorage,
  requiredFields,
  technicalStorage,
} = require('../../../../mongo/storage.js');

const appointmentStorage = [
  entity('schedules', [
    { name: 'ix_schedules_doctor_start', key: { doctorId: 1, startAt: 1 } },
    { name: 'ix_schedules_room_start', key: { room: 1, startAt: 1 } },
  ]),
  {
    ...entity('slots', [
      {
        name: 'uq_slot_schedule_start',
        key: { scheduleId: 1, startAt: 1 },
        unique: true,
      },
    ]),
    validator: requiredFields(
      ['id', 'scheduleId', 'startAt', 'capacity', 'heldCount', 'confirmedCount'],
      {
        capacity: { bsonType: ['int', 'long'], minimum: 1 },
        heldCount: { bsonType: ['int', 'long'], minimum: 0 },
        confirmedCount: { bsonType: ['int', 'long'], minimum: 0 },
      },
      {
        $expr: {
          $lte: [{ $add: ['$heldCount', '$confirmedCount'] }, '$capacity'],
        },
      },
    ),
  },
  {
    ...entity(
      'holds',
      [
        {
          name: 'uq_hold_principal_key',
          key: { principalId: 1, idempotencyKey: 1 },
          unique: true,
        },
        { name: 'ix_hold_expiry', key: { status: 1, expiresAt: 1 } },
      ],
      ['principalId', 'idempotencyKey', 'slotId', 'patientId', 'expiresAt'],
    ),
    validator: requiredFields(
      ['id', 'principalId', 'idempotencyKey', 'slotId', 'patientId', 'expiresAt'],
      {
        principalId: { bsonType: 'string', minLength: 1 },
        idempotencyKey: { bsonType: 'string', minLength: 1 },
        expiresAt: { bsonType: 'date' },
      },
    ),
  },
  entity(
    'appointments',
    [{ name: 'uq_appointment_hold', key: { holdId: 1 }, unique: true }],
    ['holdId'],
  ),
  entity(
    'queue_tickets',
    [
      {
        name: 'uq_queue_appointment_round',
        key: { appointmentId: 1, ticketType: 1, returnRound: 1 },
        unique: true,
      },
      {
        name: 'uq_queue_claim',
        key: { claimId: 1 },
        unique: true,
        partialFilterExpression: { claimId: { $type: 'string' } },
      },
    ],
    ['appointmentId', 'ticketType', 'returnRound'],
  ),
  {
    name: 'patient_time_locks',
    validator: requiredFields(['patientId']),
    indexes: [{ name: 'uq_patient_time_lock', key: { patientId: 1 }, unique: true }],
  },
  {
    name: 'command_results',
    validator: requiredFields(['command_id']),
    indexes: [{ name: 'uq_command_result', key: { command_id: 1 }, unique: true }],
  },
  {
    name: 'user_access_projection',
    indexes: [{ name: 'uq_user_access_projection', key: { userId: 1 }, unique: true }],
  },
  {
    name: 'patient_access_projection',
    indexes: [{ name: 'uq_patient_access_projection', key: { patientId: 1 }, unique: true }],
  },
  {
    name: 'projection_checkpoints',
    indexes: [{ name: 'uq_projection_checkpoint', key: { projectionName: 1 }, unique: true }],
  },
  ...technicalStorage,
];

async function ensureAppointmentStorage(connection) {
  await installStorage(connection, appointmentStorage);
}

module.exports = { appointmentStorage, ensureAppointmentStorage };
