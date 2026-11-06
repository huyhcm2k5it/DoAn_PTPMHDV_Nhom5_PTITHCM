const express = require('express');
const { createAuthContext } = require('../auth/auth.middleware.js');
const { createSchedulesController } = require('../controllers/schedules.controller.js');

function schedulesRoutes(dependencies) {
  const router = express.Router();
  const authenticate = createAuthContext({ verifyBearerToken: dependencies.verifyBearerToken });
  const controller = createSchedulesController(dependencies);
  router.get('/', authenticate, controller.list);
  router.post('/', authenticate, controller.create);
  router.patch('/:scheduleId', authenticate, controller.update);
  return router;
}

module.exports = { schedulesRoutes };
