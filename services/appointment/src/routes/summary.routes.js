const express = require('express');
const { createAuthContext } = require('../auth/auth.middleware.js');
const { createSummaryController } = require('../controllers/summary.controller.js');

function summaryRoutes(dependencies) {
  const router = express.Router();
  const authenticate = createAuthContext({ verifyBearerToken: dependencies.verifyBearerToken });
  router.get('/', authenticate, createSummaryController(dependencies).get);
  return router;
}

module.exports = { summaryRoutes };
