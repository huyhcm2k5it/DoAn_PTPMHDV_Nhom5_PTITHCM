const express = require('express');
const { requestContext } = require('./utils/request-context.js');
const { healthRoutes } = require('./routes/health.routes.js');
const { errorHandler, notFound } = require('./core/errors.js');
function createApp({ connection } = {}) {
  const app = express(); app.disable('x-powered-by'); app.use(requestContext);
  app.use('/health', healthRoutes({ connection })); app.use(notFound); app.use(errorHandler); return app;
}
module.exports = { createApp };