const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSchedule } = require('../src/services/schedules.service.js');

const doctorId = '00000000-0000-4000-8000-000000000101';
const serviceId = '00000000-0000-4000-8000-000000000201';

test('schedule parser rejects invalid ranges and normalizes admin input', () => {
  assert.throws(() => parseSchedule({ doctorId, serviceId, startAt: 'bad', endAt: '2026-11-20T10:00:00Z', capacityPerSlot: 1, slotMinutes: 30 }), /startAt is invalid/);
  assert.throws(() => parseSchedule({ doctorId, serviceId, startAt: '2026-11-20T10:00:00Z', endAt: '2026-11-20T09:00:00Z', capacityPerSlot: 1, slotMinutes: 30 }), /endAt must be after/);
  const parsed = parseSchedule({ doctorId, serviceId, startAt: '2026-11-20T08:00:00Z', endAt: '2026-11-20T10:00:00Z', capacityPerSlot: '2', slotMinutes: '30', room: ' A-101 ' });
  assert.equal(parsed.capacityPerSlot, 2);
  assert.equal(parsed.room, 'A-101');
});
