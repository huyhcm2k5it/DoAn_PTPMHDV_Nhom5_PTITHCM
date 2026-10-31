const express = require('express');
const { createAuthContext } = require('../auth/auth.middleware.js');
const { createHoldsController } = require('../controllers/holds.controller.js');
function holdsRoutes(dependencies) {
  const router = express.Router();
  const authenticate = createAuthContext({ verifyBearerToken: dependencies.verifyBearerToken });
  const controller = createHoldsController(dependencies);
  router.post('/', authenticate, controller.create);
  router.delete('/:holdId', authenticate, controller.release);
  return router;
}
module.exports = { holdsRoutes };
