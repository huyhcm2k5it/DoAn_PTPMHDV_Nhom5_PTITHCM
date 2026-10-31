const { ApiError } = require('../core/errors.js');
function createAuthContext({ verifyBearerToken } = {}) {
  return async function authContext(req, res, next) {
    try {
      const match = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
      if (!match || typeof verifyBearerToken !== 'function')
        throw new ApiError(401, 'UNAUTHENTICATED', 'Missing or invalid bearer token.');
      const claims = await verifyBearerToken(match[1]);
      if (!claims || typeof claims.sub !== 'string' || !claims.sub.trim())
        throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid token claims.');
      const actorType = String(claims.actorType || '').toUpperCase();
      if (!['PATIENT', 'DOCTOR', 'STAFF'].includes(actorType))
        throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid actor type.');
      req.authContext = Object.freeze({
        userId: claims.sub,
        actorType,
        capabilities: Array.isArray(claims.capabilities) ? claims.capabilities : [],
        scopes: Array.isArray(claims.scopes) ? claims.scopes : [],
      });
      next();
    } catch (error) {
      next(
        error instanceof ApiError
          ? error
          : new ApiError(401, 'UNAUTHENTICATED', 'Invalid token claims.'),
      );
    }
  };
}
module.exports = { createAuthContext };
