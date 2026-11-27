const { ApiError } = require('../core/errors.js');
function createScopedReadPolicy(connection) {
  return async ({ authContext, patientId }) => {
    const current = await connection
      .collection('user_access_projection')
      .findOne({ userId: authContext.userId });
    if (!current)
      throw new ApiError(
        503,
        'AUTH_PROJECTION_UNAVAILABLE',
        'Identity access projection is unavailable.',
      );
    if (
      current.status !== 'ACTIVE' ||
      current.actorType !== authContext.actorType ||
      !Number.isInteger(authContext.tokenVersion) ||
      current.tokenVersion !== authContext.tokenVersion
    )
      return false;
    if (authContext.actorType === 'STAFF')
      return Boolean(
        current.capabilities?.includes('RECEPTION') &&
        authContext.capabilities.includes('RECEPTION'),
      );
    // Only a verified signed access-token claim can grant this exact patient.
    // A generic DOCTOR token or a caller-provided header grants no patient access.
    return (
      authContext.actorType === 'DOCTOR' &&
      authContext.scopes.includes(`patient:${patientId}`)
    );
  };
}
module.exports = { createScopedReadPolicy };
