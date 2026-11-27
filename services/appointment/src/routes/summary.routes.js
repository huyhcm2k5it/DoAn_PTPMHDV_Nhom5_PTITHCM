const express = require('express');
const { currentIdentity } = require('../auth/current-identity.middleware.js');
const { createAuthContext } = require('../auth/auth.middleware.js');
const {
  createSummaryController,
} = require('../controllers/summary.controller.js');

function summaryRoutes(dependencies) {
  const router = express.Router();
  const authenticate = createAuthContext({
    verifyBearerToken: dependencies.verifyBearerToken,
  });
  router.get(
    '/',
    authenticate,
    currentIdentity(dependencies),
    createSummaryController(dependencies).get,
  );
  return router;
}

module.exports = { summaryRoutes };
