const { getSlotCache } = require('../services/slot-cache.service');
const {
  listAvailableSlots,
} = require('../services/list-available-slots.service.js');
function createSlotsController(dependencies) {
  return {
    async listAvailable(req, res, next) {
      try {
        const data = await getSlotCache().read(
          req.query.date,
          { doctorId: req.query.doctorId, serviceId: req.query.serviceId },
          () =>
            listAvailableSlots({
              Schedule: dependencies.Schedule,
              Slot: dependencies.Slot,
              doctorId: req.query.doctorId,
              serviceId: req.query.serviceId,
              date: req.query.date,
            }),
        );
        res
          .status(200)
          .set('X-Availability-As-Of', data.asOf)
          .set('X-Availability-Is-Advisory', 'true')
          .json({
            data: { items: data.items },
            meta: { correlationId: req.correlationId },
          });
      } catch (error) {
        next(error);
      }
    },
  };
}
module.exports = { createSlotsController };
