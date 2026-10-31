const { createHold, releaseHold } = require('../services/holds.service.js');
const { ApiError } = require('../core/errors.js');
function requireAccess(dependencies, req, patientId) {
  if (typeof dependencies.authorizePatientAccess !== 'function')
    throw new ApiError(
      503,
      'AUTH_PROJECTION_UNAVAILABLE',
      'Chưa có chính sách truy cập hồ sơ từ Identity.',
    );
  return dependencies
    .authorizePatientAccess({ authContext: req.authContext, patientId, action: 'APPOINTMENT_BOOK' })
    .then((allowed) => {
      if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'Không có quyền trên hồ sơ này.');
    });
}
function createHoldsController(dependencies) {
  return {
    async create(req, res, next) {
      try {
        const { patientId, slotId } = req.body || {};
        await requireAccess(dependencies, req, patientId);
        const data = await createHold({
          connection: dependencies.connection,
          patientId,
          slotId,
          principalId: req.authContext.userId,
          idempotencyKey: req.get('idempotency-key'),
          now: dependencies.now?.() || new Date(),
          createId: dependencies.createId,
          resolvePriceSnapshot: dependencies.resolvePriceSnapshot,
        });
        res.status(201).json({ data, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
    async release(req, res, next) {
      try {
        const data = await releaseHold({
          connection: dependencies.connection,
          holdId: req.params.holdId,
          principalId: req.authContext.userId,
          expectedVersion: req.query.expectedVersion,
          idempotencyKey: req.get('idempotency-key'),
          now: dependencies.now?.() || new Date(),
          createId: dependencies.createId,
        });
        res.status(200).json({ data, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
  };
}
module.exports = { createHoldsController };
