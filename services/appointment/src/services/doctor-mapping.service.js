const { ApiError } = require('../core/errors');

// Identity mappings belong to Catalog's trusted DOCTOR projection.
async function resolveDoctorMapping(connection, doctorId, session) {
  const row = await connection
    .collection('catalog_projection')
    .findOne(
      { entityType: 'DOCTOR', entityId: doctorId, active: true },
      { session },
    );
  const snapshot = row?.fullSnapshot;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    snapshot?.status !== 'ACTIVE' ||
    ![snapshot?.identityUserId, snapshot?.departmentId].every(
      (value) => typeof value === 'string' && uuid.test(value),
    )
  )
    throw new ApiError(
      409,
      'CLINICAL_MAPPING_UNAVAILABLE',
      'Trusted Catalog doctor mapping is unavailable.',
    );
  return {
    doctorUserId: snapshot.identityUserId,
    departmentId: snapshot.departmentId,
  };
}

module.exports = { resolveDoctorMapping };
