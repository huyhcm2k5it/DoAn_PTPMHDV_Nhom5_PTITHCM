const { getAdminSummary } = require('../services/summary.service.js');

function createSummaryController(dependencies) {
  return {
    async get(req, res, next) {
      try {
        const data = await getAdminSummary({
          connection: dependencies.connection,
          authContext: req.authContext,
          date: req.query.date,
        });
        res
          .status(200)
          .json({ data, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
  };
}

module.exports = { createSummaryController };
