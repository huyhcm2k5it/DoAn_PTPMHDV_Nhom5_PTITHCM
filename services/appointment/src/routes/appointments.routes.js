const express = require('express');
const { createAuthContext } = require('../auth/auth.middleware.js');
const { createAppointmentsController } = require('../controllers/appointments.controller.js');
function appointmentsRoutes(dependencies) {
  const router = express.Router();
  const authenticate = createAuthContext({ verifyBearerToken: dependencies.verifyBearerToken });
  const controller = createAppointmentsController(dependencies);
  router.post('/', authenticate, controller.create);
  router.get('/:appointmentId', authenticate, controller.getById);
  return router;
}
function patientAppointmentsRoutes(dependencies) {
  const router = express.Router();
  const authenticate = createAuthContext({ verifyBearerToken: dependencies.verifyBearerToken });
  const controller = createAppointmentsController(dependencies);
  router.get('/:patientId/appointments', authenticate, controller.listByPatient);
  return router;
}
module.exports = { appointmentsRoutes, patientAppointmentsRoutes };
