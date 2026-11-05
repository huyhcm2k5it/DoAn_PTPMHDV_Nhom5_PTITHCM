const {
  checkInAppointment,
  listTodayQueue,
  callNextQueueTicket,
  markNoShow,
} = require('../services/queue.service.js');
const { ApiError } = require('../core/errors.js');

function requireCapability(req, capability) {
  if (req.authContext.actorType !== 'STAFF' || !req.authContext.capabilities.includes(capability))
    throw new ApiError(403, 'FORBIDDEN', `${capability} capability is required.`);
}

function createQueueController(dependencies) {
  return {
    async checkIn(req, res, next) {
      try {
        requireCapability(req, 'RECEPTION');
        const data = await checkInAppointment({
          connection: dependencies.connection,
          appointmentId: req.params.appointmentId,
          staffId: req.authContext.userId,
          idempotencyKey: req.get('idempotency-key'),
          now: dependencies.now?.() || new Date(),
          createId: dependencies.createId,
        });
        res.status(200).json({ data, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
    async today(req, res, next) {
      try {
        const data = await listTodayQueue({
          connection: dependencies.connection,
          actorType: req.authContext.actorType,
          capabilities: req.authContext.capabilities,
          scopes: req.authContext.scopes,
          doctorId: req.query.doctorId,
          ticketType: req.query.ticketType,
          date: req.query.date,
          page: req.query.page,
          limit: req.query.limit,
          now: dependencies.now?.() || new Date(),
        });
        res.status(200).json({ data, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
    async callNext(req, res, next) {
      try {
        const data = await callNextQueueTicket({
          connection: dependencies.connection,
          actorType: req.authContext.actorType,
          capabilities: req.authContext.capabilities,
          scopes: req.authContext.scopes,
          doctorId: req.body?.doctorId,
          ticketType: req.body?.ticketType,
          calledBy: req.authContext.userId,
          idempotencyKey: req.get('idempotency-key'),
          now: dependencies.now?.() || new Date(),
        });
        res.status(200).json({ data, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
    async noShow(req, res, next) {
      try {
        requireCapability(req, 'RECEPTION');
        const data = await markNoShow({
          connection: dependencies.connection,
          ticketId: req.params.ticketId,
          staffId: req.authContext.userId,
          reasonCode: req.body?.reasonCode,
          expectedVersion: req.body?.expectedVersion,
          idempotencyKey: req.get('idempotency-key'),
          now: dependencies.now?.() || new Date(),
        });
        res.status(200).json({ data, meta: { correlationId: req.correlationId } });
      } catch (error) {
        next(error);
      }
    },
  };
}

module.exports = { createQueueController };
