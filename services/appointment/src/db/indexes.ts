import type { Db } from 'mongodb';
import { entity, installStorage, requiredFields, technicalStorage, type CollectionStorage } from '../../../../mongo/storage.js';

export const appointmentStorage: readonly CollectionStorage[] = [
  entity('schedules', [
    { name: 'ix_schedules_doctor_start', key: { doctorId: 1, startAt: 1 } },
    { name: 'ix_schedules_room_start', key: { room: 1, startAt: 1 } },
  ]),
  {
    ...entity('slots', [{ name: 'uq_slot_schedule_start', key: { scheduleId: 1, startAt: 1 }, unique: true }]),
    validator: requiredFields(['id', 'scheduleId', 'startAt', 'capacity', 'heldCount', 'confirmedCount'], {
      capacity: { bsonType: ['int', 'long'], minimum: 1 },
      heldCount: { bsonType: ['int', 'long'], minimum: 0 },
      confirmedCount: { bsonType: ['int', 'long'], minimum: 0 },
    }, { $expr: { $lte: [{ $add: ['$heldCount', '$confirmedCount'] }, '$capacity'] } }),
  },
  {
    ...entity('holds', [
    { name: 'uq_hold_principal_key', key: { principalId: 1, idempotencyKey: 1 }, unique: true },
    { name: 'ix_hold_expiry', key: { status: 1, expiresAt: 1 } },
    ], ['principalId', 'idempotencyKey', 'slotId', 'patientId', 'expiresAt']),
    validator: requiredFields(['id', 'principalId', 'idempotencyKey', 'slotId', 'patientId', 'expiresAt'], {
      principalId: { bsonType: 'string', minLength: 1 },
      idempotencyKey: { bsonType: 'string', minLength: 1 },
      expiresAt: { bsonType: 'date' },
    }),
  },
  entity('appointments', [{ name: 'uq_appointment_hold', key: { holdId: 1 }, unique: true }], ['holdId']),
  entity('queue_tickets', [
    { name: 'uq_queue_appointment_round', key: { appointmentId: 1, ticketType: 1, returnRound: 1 }, unique: true },
    { name: 'uq_queue_claim', key: { claimId: 1 }, unique: true, partialFilterExpression: { claimId: { $type: 'string' } } },
  ], ['appointmentId', 'ticketType', 'returnRound']),
  { name: 'patient_time_locks', validator: requiredFields(['patientId']), indexes: [
    { name: 'uq_patient_time_lock', key: { patientId: 1 }, unique: true },
  ] },
  { name: 'command_results', validator: requiredFields(['command_id']), indexes: [
    { name: 'uq_command_result', key: { command_id: 1 }, unique: true },
  ] },
  ...technicalStorage,
];

export async function ensureAppointmentStorage(db: Db): Promise<void> { await installStorage(db, appointmentStorage); }
