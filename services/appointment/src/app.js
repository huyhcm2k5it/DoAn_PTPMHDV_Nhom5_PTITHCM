const express = require('express');
const { requestContext } = require('./utils/request-context.js');
const { healthRoutes } = require('./routes/health.routes.js');
const { slotsRoutes } = require('./routes/slots.routes.js');
const { holdsRoutes } = require('./routes/holds.routes.js');
const {
  appointmentsRoutes,
  patientAppointmentsRoutes,
} = require('./routes/appointments.routes.js');
const { errorHandler, notFound } = require('./core/errors.js');
const { getScheduleModel, getSlotModel } = require('./models/appointment.model.js');
const {
  authorizePatientAccess: defaultAuthorizePatientAccess,
} = require('./services/access-projection.service.js');
function createApp({
  connection,
  verifyBearerToken,
  authorizePatientAccess,
  now,
  createId,
  resolvePriceSnapshot,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(express.json({ limit: '32kb' }));
  app.use('/health', healthRoutes({ connection }));
  if (connection) {
    const dependencies = {
      connection,
      verifyBearerToken,
      authorizePatientAccess:
        authorizePatientAccess ||
        ((args) => defaultAuthorizePatientAccess({ connection, ...args })),
      now,
      createId,
      resolvePriceSnapshot,
    };
    app.use(
      '/api/v1/slots',
      slotsRoutes({ Schedule: getScheduleModel(connection), Slot: getSlotModel(connection) }),
    );
    app.use('/api/v1/appointment-holds', holdsRoutes(dependencies));
    app.use('/api/v1/appointments', appointmentsRoutes(dependencies));
    app.use('/api/v1/patients', patientAppointmentsRoutes(dependencies));
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
