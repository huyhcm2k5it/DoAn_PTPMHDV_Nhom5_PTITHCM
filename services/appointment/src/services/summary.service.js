const {
  getAppointmentRepository,
  getQueueTicketRepository,
} = require('./appointment.repository');
const { businessDateRange } = require('../utils/business-date.js');
const { getReportSyncStatus } = require('./report-sync.service.js');
const { ApiError } = require('../core/errors.js');

function assertAdmin(authContext) {
  if (
    authContext?.actorType !== 'STAFF' ||
    !authContext.capabilities?.includes('ADMIN')
  )
    throw new ApiError(403, 'FORBIDDEN', 'ADMIN capability is required.');
}

async function getAdminSummary({
  connection,
  authContext,
  from,
  to,
  now = new Date(),
}) {
  assertAdmin(authContext);
  const range = businessDateRange({ from, to, required: true });
  const asOf = now.toISOString();
  const Appointment = getAppointmentRepository(connection);
  const QueueTicket = getQueueTicketRepository(connection);
  const [appointments, queueRows, syncStatus] = await Promise.all([
    Appointment.find({ startAt: range }).lean(),
    QueueTicket.find({ appointmentDate: { $gte: from, $lt: to } })
      .lean()
      .then((rows) => {
        const counts = {};
        for (const row of rows)
          counts[row.state] = (counts[row.state] || 0) + 1;
        return Object.entries(counts).map(([_id, count]) => ({ _id, count }));
      }),
    getReportSyncStatus(connection),
  ]);
  const byState = {};
  const metrics = { booked: 0, cancelled: 0, checkedIn: 0, completed: 0 };
  for (const appointment of appointments) {
    byState[appointment.state] = (byState[appointment.state] || 0) + 1;
    const history =
      Array.isArray(appointment.stateHistory) && appointment.stateHistory.length
        ? appointment.stateHistory
        : [
            {
              state: appointment.state,
              at: appointment.updatedAt || appointment.createdAt,
            },
          ];
    const states = new Set(history.map((entry) => entry.state));
    if (
      states.has('PENDING_PAYMENT') ||
      states.has('SETTLEMENT_LOCKED') ||
      states.has('CONFIRMED')
    )
      metrics.booked += 1;
    if (states.has('CANCELLED')) metrics.cancelled += 1;
    if (states.has('CHECKED_IN') || appointment.checkedInAt)
      metrics.checkedIn += 1;
    if (states.has('COMPLETED')) metrics.completed += 1;
  }
  const queueByState = Object.fromEntries(
    queueRows.map((row) => [row._id, row.count]),
  );
  return {
    from,
    to,
    asOf,
    syncStatus,
    appointments: { total: appointments.length, byState, metrics },
    queue: {
      total: queueRows.reduce((sum, row) => sum + row.count, 0),
      byState: queueByState,
    },
  };
}

module.exports = { getAdminSummary };
