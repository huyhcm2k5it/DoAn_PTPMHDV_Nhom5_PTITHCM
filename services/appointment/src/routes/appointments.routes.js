const express = require('express');
const { createAuthContext } = require('../auth/auth.middleware.js');
const { createAppointmentsController } = require('../controllers/appointments.controller.js');
const { createQueueController } = require('../controllers/queue.controller.js');
function appointmentsRoutes(dependencies) {
  const router = express.Router();
  const authenticate = createAuthContext({ verifyBearerToken: dependencies.verifyBearerToken });
  const controller = createAppointmentsController(dependencies);
  const queueController = createQueueController(dependencies);
  router.post('/', authenticate, controller.create);
  router.post('/:appointmentId/check-in', authenticate, queueController.checkIn);
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
