const { ApiError } = require('../core/errors.js');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function vietnamDayRange(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(date + 'T00:00:00+07:00');
  if (!Number.isFinite(start.getTime())) return null;
  const localDate = new Date(start.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (localDate !== date) return null;
  return { start, next: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}
async function listAvailableSlots({ Schedule, Slot, doctorId, serviceId, date }) {
  if (!UUID.test(doctorId || '') || !UUID.test(serviceId || '')) throw new ApiError(400, 'VALIDATION_ERROR', 'doctorId/serviceId must be UUIDs.');
  const range = vietnamDayRange(date || '');
  if (!range) throw new ApiError(400, 'VALIDATION_ERROR', 'date must be a valid YYYY-MM-DD date.');
  const schedules = await Schedule.find({ doctorId, serviceId, status: 'OPEN', startAt: { $lt: range.next }, endAt: { $gte: range.start } }).select({ id: 1 }).lean();
  if (!schedules.length) return [];
  const slots = await Slot.find({ scheduleId: { $in: schedules.map((schedule) => schedule.id) }, startAt: { $gte: range.start, $lt: range.next } }).sort({ startAt: 1 }).lean();
  return slots.filter((slot) => slot.capacity > slot.heldCount + slot.confirmedCount).map((slot) => ({ slotId: slot.id, scheduleId: slot.scheduleId, doctorId, serviceId, startAt: slot.startAt, endAt: slot.endAt, remainingCapacity: slot.capacity - slot.heldCount - slot.confirmedCount }));
}
module.exports = { listAvailableSlots, vietnamDayRange, UUID };