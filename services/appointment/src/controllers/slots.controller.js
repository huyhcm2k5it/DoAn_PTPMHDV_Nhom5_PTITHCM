const { listAvailableSlots } = require('../services/list-available-slots.service.js');
function createSlotsController(dependencies) {
  return {
    async listAvailable(req, res, next) {
      try {
        const items = await listAvailableSlots({ Schedule: dependencies.Schedule, Slot: dependencies.Slot, doctorId: req.query.doctorId, serviceId: req.query.serviceId, date: req.query.date });
        res.status(200).json({ data: { items }, meta: { correlationId: req.correlationId } });
      } catch (error) { next(error); }
    },
  };
}
module.exports = { createSlotsController };