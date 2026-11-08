const { failure, staffAccess } = require('../services/common');
function createAuthContext({ connection, verifyBearerToken }) {
  return async (req, res, next) => {
    try {
      const match = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
      let claims;
      try {
        claims = match && (await verifyBearerToken?.(match[1]));
      } catch {
        claims = null;
      }
      if (
        !claims?.sub ||
        !['STAFF', 'PATIENT', 'DOCTOR'].includes(claims.actorType) ||
        !Number.isInteger(claims.tokenVersion) || claims.action || claims.tokenType === 'LEASE'
      )
        throw failure(401, 'UNAUTHENTICATED', 'A valid access token is required.');
      const user = await connection
        .collection('user_access_projection')
        .findOne({ userId: claims.sub });
      if (!user) throw failure(503, 'SERVICE_UNAVAILABLE', 'Identity projection is unavailable.');
      if (
        user.status !== 'ACTIVE' ||
        user.tokenVersion !== claims.tokenVersion ||
        user.actorType !== claims.actorType
      )
        throw failure(403, 'FORBIDDEN', 'Account access is no longer valid.');
      req.authContext = {
        userId: claims.sub,
        actorType: user.actorType,
        capabilities: user.capabilities || [],
        tokenVersion: user.tokenVersion,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
function requirePharmacy(connection) {
  return async (req, res, next) => {
    try {
      await staffAccess(
        connection,
        req.authContext.userId,
        undefined,
        req.authContext.tokenVersion,
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}
function requireLease({ verifyAuthorizationLease, now }, action) {
  return async (req, res, next) => {
    try {
      const token = req.get('x-authorization-lease');
      if (!token || !verifyAuthorizationLease)
        throw failure(
          403,
          'AUTHORIZATION_LEASE_REQUIRED',
          'A fresh Identity authorization lease is required.',
        );
      let lease;
      try {
        lease = await verifyAuthorizationLease(token, {
          action,
          subject: req.authContext.userId,
          tokenVersion: req.authContext.tokenVersion,
        });
      } catch (error) {
        if (/expir/i.test(error?.message || '')) throw failure(401, 'AUTHZ_LEASE_EXPIRED', 'Authorization lease expired.');
        throw failure(
          403,
          'AUTHORIZATION_LEASE_INVALID',
          'Authorization lease is expired or invalid.',
        );
      }
      if (lease?.exp != null && lease.exp * 1000 <= +(now?.() || new Date())) throw failure(401, 'AUTHZ_LEASE_EXPIRED', 'Authorization lease expired.');
      if (
        !lease ||
        lease.sub !== req.authContext.userId ||
        lease.tokenVersion !== req.authContext.tokenVersion ||
        lease.action !== action
      )
        throw failure(
          403,
          'AUTHORIZATION_LEASE_INVALID',
          'Authorization lease identity or action differs.',
        );
      next();
    } catch (error) {
      next(error);
    }
  };
}
module.exports = { createAuthContext, requirePharmacy, requireLease };
