const { ApiError } = require('../core/errors.js');
function currentIdentity({ connection }) {
  return async (req, res, next) => {
    try {
      const auth = req.authContext;
      const row = await connection
        .collection('user_access_projection')
        .findOne({ userId: auth.userId });
      if (!row)
        throw new ApiError(
          503,
          'AUTH_PROJECTION_UNAVAILABLE',
          'Identity access projection is unavailable.',
        );
      if (
        row.status !== 'ACTIVE' ||
        row.actorType !== auth.actorType ||
        !Number.isInteger(auth.tokenVersion) ||
        row.tokenVersion !== auth.tokenVersion
      )
        throw new ApiError(
          403,
          'FORBIDDEN',
          'Identity access has been revoked.',
        );
      req.authContext = Object.freeze({
        ...auth,
        capabilities: auth.capabilities.filter((capability) =>
          row.capabilities?.includes(capability),
        ),
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}
module.exports = { currentIdentity };
