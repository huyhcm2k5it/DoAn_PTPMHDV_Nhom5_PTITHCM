const {
  createAppointment,
  getAppointment,
  listPatientAppointments,
} = require('../services/appointments.service.js');
const { ApiError } = require('../core/errors.js');
async function checkPatientAccess(dependencies, req, patientId, action) {
  if (typeof dependencies.authorizePatientAccess !== 'function')
    throw new ApiError(
      503,
      'AUTH_PROJECTION_UNAVAILABLE',
      'Chưa có chính sách truy cập hồ sơ từ Identity.',
    );
  if (
    !(await dependencies.authorizePatientAccess({
      authContext: req.authContext,
      patientId,
      action,
    }))
  )
    throw new ApiError(403, 'FORBIDDEN', 'Không có quyền trên hồ sơ này.');
}
function createAppointmentsController(dependencies) {
  return {
    async create(req, res, next) {
      try {
        const { patientId, holdId } = req.body || {};
        await checkPatientAccess(dependencies, req, patientId, 'APPOINTMENT_CREATE');
        const data = await createAppointment({
          connection: dependencies.connection,
          principalId: req.authContext.userId,
          patientId,
          holdId,
          idempotencyKey: req.get('idempotency-key'),
          correlationId: req.correlationId,
          now: dependencies.now?.() || new Date(),
          createId: dependencies.createId,
        });
        res
          .status(202)
          .setHeader('location', data.statusUrl)
          .json({ data, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
    async getById(req, res, next) {
      try {
        const data = await getAppointment({
          connection: dependencies.connection,
          appointmentId: req.params.appointmentId,
          principalId: req.authContext.actorType === 'PATIENT' ? req.authContext.userId : undefined,
        });
        await checkPatientAccess(dependencies, req, data.appointment.patientId, 'APPOINTMENT_READ');
        res.status(200).json({ data, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
    async listByPatient(req, res, next) {
      try {
        await checkPatientAccess(dependencies, req, req.params.patientId, 'APPOINTMENT_LIST');
        const data = await listPatientAppointments({
          connection: dependencies.connection,
          patientId: req.params.patientId,
          principalId: req.authContext.actorType === 'PATIENT' ? req.authContext.userId : undefined,
          state: req.query.state,
          from: req.query.from,
          to: req.query.to,
          page: req.query.page,
          limit: req.query.limit,
        });
        res.status(200).json({ data, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
  };
}
module.exports = { createAppointmentsController };
