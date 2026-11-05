const express = require('express');
const { createAuthContext } = require('../auth/auth.middleware.js');
const { createQueueController } = require('../controllers/queue.controller.js');

function queueRoutes(dependencies) {
  const router = express.Router();
  const authenticate = createAuthContext({ verifyBearerToken: dependencies.verifyBearerToken });
  const controller = createQueueController(dependencies);
  router.get('/today', authenticate, controller.today);
  router.post('/call-next', authenticate, controller.callNext);
  router.post('/:ticketId/no-show', authenticate, controller.noShow);
  return router;
}

module.exports = { queueRoutes };
