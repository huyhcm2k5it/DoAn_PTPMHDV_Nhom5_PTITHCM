const express = require('express');
const { requestContext } = require('./utils/request-context.js');
const { healthRoutes } = require('./routes/health.routes.js');
const { slotsRoutes } = require('./routes/slots.routes.js');
const { errorHandler, notFound } = require('./core/errors.js');
const { getScheduleModel, getSlotModel } = require('./models/appointment.model.js');
function createApp({ connection } = {}) {
  const app = express();
  app.disable('x-powered-by'); app.use(requestContext); app.use(express.json({ limit: '32kb' }));
  app.use('/health', healthRoutes({ connection }));
  if (connection) app.use('/api/v1/slots', slotsRoutes({ Schedule: getScheduleModel(connection), Slot: getSlotModel(connection) }));
  app.use(notFound); app.use(errorHandler);
  return app;
}
module.exports = { createApp };