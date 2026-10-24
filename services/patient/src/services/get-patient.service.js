const { ApiError } = require('../core/errors.js');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function getPatient({ repository, authContext, patientId, authorizeScopedRead }) {
  if (!UUID.test(patientId)) throw new ApiError(400, 'VALIDATION_ERROR', 'patientId must be a UUID.');
  let allowed = authContext.actorType === 'PATIENT' && Boolean(authContext.userId);
  if (authContext.actorType !== 'PATIENT' && typeof authorizeScopedRead === 'function') allowed = await authorizeScopedRead({ authContext, patientId });
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'Actor is not allowed to read this patient.');
  const patient = authContext.actorType === 'PATIENT' ? await repository.findOwned(patientId, authContext.userId) : await repository.findById(patientId);
  if (!patient) throw new ApiError(404, 'NOT_FOUND', 'Patient record not found.');
  return patient;
}
module.exports = { getPatient, UUID };