const { requireLease } = require('../auth/lease.middleware');
const express = require('express');
const { currentIdentity } = require('../auth/current-identity.middleware.js');
const { createAuthContext } = require('../auth/auth.middleware.js');
const { createQueueController } = require('../controllers/queue.controller.js');

function queueRoutes(dependencies) {
  const router = express.Router();
  const authenticate = createAuthContext({
    verifyBearerToken: dependencies.verifyBearerToken,
  });
  const controller = createQueueController(dependencies);
  router.get(
    '/today',
    authenticate,
    currentIdentity(dependencies),
    controller.today,
  );
  router.post(
    '/call-next',
    authenticate,
    requireLease(dependencies, 'AP-017'),
    controller.callNext,
  );
  router.post(
    '/:ticketId/no-show',
    authenticate,
    requireLease(dependencies, 'AP-018'),
    controller.noShow,
  );
  return router;
}

module.exports = { queueRoutes };
