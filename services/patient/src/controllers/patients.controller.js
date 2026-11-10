const { listPatients } = require('../services/list-patients.service.js');
const { getPatient } = require('../services/get-patient.service.js');
const {
  createPatient,
  updatePatient,
  searchPatients,
} = require('../services/manage-patient.service.js');
const { ApiError } = require('../core/errors.js');
function createPatientsController(dependencies) {
  return {
    async list(req, res, next) {
      try {
        const projection = Number.isInteger(req.authContext.tokenVersion)
          ? await dependencies.getUserProjection(req.authContext.userId)
          : null;
        if (Number.isInteger(req.authContext.tokenVersion)) {
          if (!projection || projection.status !== 'ACTIVE')
            throw new ApiError(
              503,
              'AUTH_PROJECTION_UNAVAILABLE',
              'Identity access projection is unavailable.',
            );
          if (projection.tokenVersion !== req.authContext.tokenVersion)
            throw new ApiError(403, 'FORBIDDEN', 'Token has been revoked.');
        }
        const result = await listPatients({
          repository: dependencies.repository,
          authContext: req.authContext,
          page: req.query.page,
          limit: req.query.limit,
        });
        res
          .status(200)
          .json({ data: result, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
    async getById(req, res, next) {
      try {
        const projection = Number.isInteger(req.authContext.tokenVersion)
          ? await dependencies.getUserProjection(req.authContext.userId)
          : null;
        if (Number.isInteger(req.authContext.tokenVersion)) {
          if (!projection || projection.status !== 'ACTIVE')
            throw new ApiError(
              503,
              'AUTH_PROJECTION_UNAVAILABLE',
              'Identity access projection is unavailable.',
            );
          if (projection.tokenVersion !== req.authContext.tokenVersion)
            throw new ApiError(403, 'FORBIDDEN', 'Token has been revoked.');
        }
        const patient = await getPatient({
          repository: dependencies.repository,
          authContext: req.authContext,
          patientId: req.params.patientId,
          authorizeScopedRead: dependencies.authorizeScopedRead,
        });
        res.status(200).json({
          data: { patient },
          meta: { correlationId: req.correlationId },
        });
      } catch (error) {
        next(error);
      }
    },
    async search(req, res, next) {
      try {
        const projection = await dependencies.getUserProjection(
          req.authContext.userId,
        );
        const data = await searchPatients({
          repository: dependencies.repository,
          authContext: req.authContext,
          projection,
          query: req.query.q,
          page: req.query.page,
          limit: req.query.limit,
        });
        res
          .status(200)
          .json({ data, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
    async create(req, res, next) {
      try {
        const patient = await createPatient({
          connection: dependencies.connection,
          Patient: dependencies.Patient,
          authContext: req.authContext,
          body: req.body,
          idempotencyKey: req.get('idempotency-key'),
          requestId: req.correlationId,
          correlationId: req.correlationId,
          createId: dependencies.createId,
          now: dependencies.now?.() || new Date(),
        });
        res.status(201).json({
          data: { patient },
          meta: { correlationId: req.correlationId },
        });
      } catch (error) {
        next(error);
      }
    },
    async update(req, res, next) {
      try {
        const patient = await updatePatient({
          connection: dependencies.connection,
          Patient: dependencies.Patient,
          authContext: req.authContext,
          patientId: req.params.patientId,
          body: req.body,
          idempotencyKey: req.get('idempotency-key'),
          requestId: req.correlationId,
          correlationId: req.correlationId,
          expectedVersion: req.body?.expectedVersion,
          now: dependencies.now?.() || new Date(),
        });
        res.status(200).json({
          data: { patient },
          meta: { correlationId: req.correlationId },
        });
      } catch (error) {
        next(error);
      }
    },
  };
}
module.exports = { createPatientsController };
