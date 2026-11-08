const { ApiError } = require('../core/errors');
function requireLease(dependencies, action) {
  return async (req, res, next) => {
    try {
      const token = req.get('x-authorization-lease');
      if (!token || !dependencies.verifyAuthorizationLease) throw new ApiError(403, 'AUTHZ_LEASE_REQUIRED', 'A fresh Identity authorization lease is required.');
      let lease;
      try { lease = await dependencies.verifyAuthorizationLease(token, { action, subject: req.authContext.userId, tokenVersion: req.authContext.tokenVersion }); }
      catch (error) { throw new ApiError(/expir/i.test(error.message || '') ? 401 : 403, /expir/i.test(error.message || '') ? 'AUTHZ_LEASE_EXPIRED' : 'AUTHZ_LEASE_INVALID', 'Authorization lease is invalid or expired.'); }
      const now = +(dependencies.now?.() || new Date()) / 1000;
      if (!lease || lease.tokenType !== 'LEASE' || lease.action !== action || lease.sub !== req.authContext.userId || lease.tokenVersion !== req.authContext.tokenVersion) throw new ApiError(403, 'AUTHZ_LEASE_INVALID', 'Authorization lease identity or action differs.');
      if (!Number.isFinite(lease.iat) || !Number.isFinite(lease.exp) || lease.exp <= now || lease.iat > now || lease.exp - lease.iat > 30) throw new ApiError(401, 'AUTHZ_LEASE_EXPIRED', 'Authorization lease expired.');
      const resourceId = req.params.patientId || req.params.appointmentId || req.params.holdId || req.params.scheduleId || req.params.ticketId;
      if (lease.resourceId && lease.resourceId !== resourceId) throw new ApiError(403, 'AUTHZ_LEASE_INVALID', 'Authorization lease resource differs.');
      req.authorizationLease = lease;
      next();
    } catch (error) { next(error); }
  };
}
module.exports = { requireLease };
