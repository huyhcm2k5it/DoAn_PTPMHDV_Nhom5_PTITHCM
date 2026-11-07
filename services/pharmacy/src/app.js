const express = require('express');
const { requestContext } = require('./utils/request-context.js');
const { healthRoutes } = require('./routes/health.routes.js');
const { errorHandler, notFound } = require('./core/errors.js');
const { pharmacyRoutes } = require('./routes/pharmacy.routes');
function createApp({ connection, verifyBearerToken, verifyAuthorizationLease, now } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(express.json({ limit: '64kb' }));
  app.use('/health', healthRoutes({ connection }));
  if (connection)
    app.use(
      '/api/v1/pharmacy',
      pharmacyRoutes({ connection, verifyBearerToken, verifyAuthorizationLease, now }),
    );
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
