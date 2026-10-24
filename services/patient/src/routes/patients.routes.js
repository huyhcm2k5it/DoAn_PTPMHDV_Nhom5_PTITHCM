const express = require('express');
const { createAuthContext } = require('../auth/auth.middleware.js');
const { createPatientsController } = require('../controllers/patients.controller.js');
function patientsRoutes(dependencies) {
  const router = express.Router();
  const authenticate = createAuthContext({ verifyBearerToken: dependencies.verifyBearerToken });
  const controller = createPatientsController(dependencies);
  router.get('/', authenticate, controller.list);
  router.get('/:patientId', authenticate, controller.getById);
  return router;
}
module.exports = { patientsRoutes };