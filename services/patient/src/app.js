const express = require('express');
const { requestContext } = require('./utils/request-context.js');
const { healthRoutes } = require('./routes/health.routes.js');
const { patientsRoutes } = require('./routes/patients.routes.js');
const { errorHandler, notFound } = require('./core/errors.js');
const { getPatientModel } = require('./models/patient.model.js');
const { createPatientsRepository } = require('./dbs/patient.repository.js');
function createApp({ connection, verifyBearerToken, authorizeScopedRead } = {}) {
  const app = express();
  app.disable('x-powered-by'); app.use(requestContext); app.use(express.json({ limit: '32kb' }));
  app.use('/health', healthRoutes({ connection }));
  if (connection) app.use('/api/v1/patients', patientsRoutes({ repository: createPatientsRepository(getPatientModel(connection)), verifyBearerToken, authorizeScopedRead }));
  app.use(notFound); app.use(errorHandler);
  return app;
}
module.exports = { createApp };