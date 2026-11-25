const {
  entity,
  installStorage,
  requiredFields,
  technicalStorage,
} = require('../../../../mongo/storage.js');

const appointmentStorage = [
  {
    name: 'retry_jobs',
    indexes: [
      { name: 'uq_retry_job', key: { id: 1 }, unique: true },
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
      [
        'id',
        'scheduleId',
        'startAt',
        'capacity',
        'heldCount',
        'confirmedCount',
      ],
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
      [
        'id',
        'principalId',
        'idempotencyKey',
        'slotId',
        'patientId',
        'expiresAt',
      ],
      {
        principalId: { bsonType: 'string', minLength: 1 },
        idempotencyKey: { bsonType: 'string', minLength: 1 },
        expiresAt: { bsonType: 'date' },
      },
    ),
  },
  entity(
    'appointments',
    [
      { name: 'uq_appointment_hold', key: { holdId: 1 }, unique: true },
      {
        name: 'ix_appointment_patient_slot_state',
        key: { patientId: 1, slotId: 1, state: 1 },
      },
    ],
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
      {
        name: 'ix_queue_state_appointment',
        key: { state: 1, ticketType: 1, appointmentId: 1, id: 1 },
      },
    ],
    ['appointmentId', 'ticketType', 'returnRound'],
  ),
  {
    name: 'patient_time_locks',
    validator: requiredFields(['patientId']),
    indexes: [
      { name: 'uq_patient_time_lock', key: { patientId: 1 }, unique: true },
    ],
  },
  {
    name: 'command_results',
    validator: requiredFields(['command_id']),
    indexes: [
      { name: 'uq_command_result', key: { command_id: 1 }, unique: true },
      {
        name: 'uq_command_request',
        key: { request_id: 1 },
        unique: true,
        sparse: true,
      },
    ],
  },
  {
    name: 'user_access_projection',
    indexes: [
      { name: 'uq_user_access_projection', key: { userId: 1 }, unique: true },
    ],
  },
  {
    name: 'patient_access_projection',
    indexes: [
      {
        name: 'uq_patient_access_projection',
        key: { patientId: 1 },
        unique: true,
      },
    ],
  },
  {
    name: 'catalog_projection',
    indexes: [
      { name: 'uq_catalog_entity', key: { entityKey: 1 }, unique: true },
      {
        name: 'ix_catalog_type_id',
        key: { entityType: 1, entityId: 1, entityVersion: -1 },
      },
    ],
  },
  {
    name: 'projection_checkpoints',
    indexes: [
      {
        name: 'uq_projection_checkpoint',
        key: { projectionName: 1 },
        unique: true,
      },
    ],
  },
  {
    name: 'settlement_decisions',
    indexes: [
      {
        name: 'uq_settlement_decision_version',
        key: { settlementId: 1, decisionVersion: 1 },
        unique: true,
      },
    ],
  },
  { name: 'schedule_write_locks', indexes: [] },
  {
    name: 'outbox',
    indexes: [
      {
        name: 'ix_appointment_source_messages',
        key: { aggregate_id: 1, message_type: 1, occurred_at: 1 },
      },
      {
        name: 'ix_appointment_queue_events',
        key: { message_type: 1, 'payload.appointmentId': 1 },
      },
    ],
  },
  {
    name: 'inbox',
    indexes: [
      {
        name: 'ix_appointment_delivery_source',
        key: { consumer_name: 1, 'payload.sourceId': 1 },
      },
      {
        name: 'ix_appointment_delivery_charge',
        key: { consumer_name: 1, 'payload.chargeId': 1 },
      },
    ],
  },
  {
    name: 'command_results',
    indexes: [
      {
        name: 'ix_appointment_reserve_source',
        key: { command_type: 1, 'request.sourceId': 1 },
      },
    ],
  },
  {
    name: 'slots',
    indexes: [{ name: 'ix_slot_time_window', key: { startAt: 1, endAt: 1 } }],
  },
  {
    name: 'queue_tickets',
    indexes: [
      { name: 'ix_queue_visit_lookup', key: { appointmentId: 1, visitId: 1 } },
    ],
  },
  ...technicalStorage,
];

async function ensureAppointmentStorage(connection) {
  await installStorage(connection, appointmentStorage);
}

module.exports = { appointmentStorage, ensureAppointmentStorage };
