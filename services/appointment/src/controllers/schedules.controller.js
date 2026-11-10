const {
  createSchedule,
  updateSchedule,
  listSchedules,
} = require('../services/schedules.service.js');

function createSchedulesController(dependencies) {
  return {
    async list(req, res, next) {
      try {
        const data = await listSchedules({
          connection: dependencies.connection,
          authContext: req.authContext,
          from: req.query.from,
          to: req.query.to,
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
        const data = await createSchedule({
          connection: dependencies.connection,
          authContext: req.authContext,
          body: req.body,
          createId: dependencies.createId,
          now: dependencies.now?.() || new Date(),
        });
        res
          .status(201)
          .json({ data, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
    async update(req, res, next) {
      try {
        const data = await updateSchedule({
          connection: dependencies.connection,
          authContext: req.authContext,
          scheduleId: req.params.scheduleId,
          body: req.body,
          now: dependencies.now?.() || new Date(),
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

module.exports = { createSchedulesController };
