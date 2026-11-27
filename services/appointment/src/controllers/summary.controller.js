const { getAdminSummary } = require('../services/summary.service.js');

function createSummaryController(dependencies) {
  return {
    async get(req, res, next) {
      try {
        const data = await getAdminSummary({
          connection: dependencies.connection,
          authContext: req.authContext,
          from: req.query.from,
          to: req.query.to,
          now: dependencies.now?.() || new Date(),
        });
        res.status(200).json({
          data: {
            ...data.appointments.metrics,
            asOf: data.asOf,
            syncStatus: data.syncStatus,
          },
          meta: { correlationId: req.correlationId },
        });
      } catch (error) {
        next(error);
      }
    },
  };
}

module.exports = { createSummaryController };
