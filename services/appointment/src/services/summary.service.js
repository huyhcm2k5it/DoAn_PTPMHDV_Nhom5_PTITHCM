const { getAppointmentModel, getQueueTicketModel } = require('../models/appointment.model.js');
const { ApiError } = require('../core/errors.js');

function assertAdmin(authContext) {
  if (authContext?.actorType !== 'STAFF' || !authContext.capabilities?.includes('ADMIN'))
    throw new ApiError(403, 'FORBIDDEN', 'ADMIN capability is required.');
}

async function getAdminSummary({ connection, authContext, date }) {
  assertAdmin(authContext);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || ''))
    throw new ApiError(400, 'VALIDATION_ERROR', 'date must be YYYY-MM-DD.');
  const start = new Date(`${date}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const Appointment = getAppointmentModel(connection);
  const QueueTicket = getQueueTicketModel(connection);
  const [appointments, queueRows] = await Promise.all([
    Appointment.find({ startAt: { $gte: start, $lt: end } }).lean(),
    QueueTicket.aggregate([
      { $match: { appointmentDate: date } },
      { $group: { _id: '$state', count: { $sum: 1 } } },
    ]),
  ]);
  const byState = {};
  const metrics = { booked: 0, cancelled: 0, checkedIn: 0, completed: 0 };
  for (const appointment of appointments) {
    byState[appointment.state] = (byState[appointment.state] || 0) + 1;
    const history = Array.isArray(appointment.stateHistory) && appointment.stateHistory.length
      ? appointment.stateHistory
      : [{ state: appointment.state, at: appointment.updatedAt || appointment.createdAt }];
    const states = new Set(history.map((entry) => entry.state));
    if (states.has('PENDING_PAYMENT') || states.has('SETTLEMENT_LOCKED') || states.has('CONFIRMED')) metrics.booked += 1;
    if (states.has('CANCELLED')) metrics.cancelled += 1;
    if (states.has('CHECKED_IN') || appointment.checkedInAt) metrics.checkedIn += 1;
    if (states.has('COMPLETED')) metrics.completed += 1;
  }
  const queueByState = Object.fromEntries(queueRows.map((row) => [row._id, row.count]));
  return {
    date,
    appointments: { total: appointments.length, byState, metrics },
    queue: { total: queueRows.reduce((sum, row) => sum + row.count, 0), byState: queueByState },
  };
}

module.exports = { getAdminSummary };
