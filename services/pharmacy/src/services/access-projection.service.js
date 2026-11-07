const { consume, uuid, integer, failure, hash } = require('./common');
async function applyAccessProjection({ connection, message, now = new Date() }) {
  const identity = message.messageType === 'IdentityAccessChanged';
  const patient = message.messageType === 'PatientAccessChanged';
  if (!identity && !patient)
    throw failure(400, 'INVALID_MESSAGE', 'Unsupported access projection.');
  if (
    message.messageKind !== 'EVENT' ||
    ![identity ? 'identity' : 'patient', identity ? 'Identity' : 'Patient'].includes(
      message.producer,
    )
  )
    throw failure(400, 'INVALID_MESSAGE', 'Trusted access projection required.');
  const p = message.payload;
  const version = p.policyVersion ?? p.version;
  integer(version, 'policyVersion');
  const query = identity ? { userId: uuid(p.userId) } : { patientId: uuid(p.patientId) };
  if (identity) {
    integer(p.tokenVersion, 'tokenVersion');
    if (
      !['PATIENT', 'DOCTOR', 'STAFF'].includes(p.actorType) ||
      !Array.isArray(p.capabilities) ||
      p.capabilities.some((c) => typeof c !== 'string') ||
      !['ACTIVE', 'INACTIVE', 'REVOKED', 'LOCKED', 'DISABLED'].includes(p.status)
    )
      throw failure(400, 'INVALID_MESSAGE', 'Invalid identity access snapshot.');
  } else {
    uuid(p.ownerUserId);
    if (typeof p.active !== 'boolean')
      throw failure(400, 'INVALID_MESSAGE', 'Invalid patient access snapshot.');
  }
  return consume({ connection, message, now, consumerName: 'pharmacy-access' }, async (session) => {
    const coll = connection.collection(
      identity ? 'user_access_projection' : 'patient_access_projection',
    );
    const current = await coll.findOne(query, { session });
    const value = identity
      ? {
          ...query,
          actorType: p.actorType,
          capabilities: p.capabilities,
          tokenVersion: p.tokenVersion,
          status: p.status,
          policyVersion: version,
        }
      : { ...query, ownerUserId: p.ownerUserId, active: p.active, policyVersion: version };
    const payloadHash = hash(value);
    if (current?.policyVersion === version && current.payloadHash !== payloadHash)
      throw failure(409, 'PROJECTION_CONFLICT', 'Same access version differs.');
    if (!current || current.policyVersion < version)
      await coll.replaceOne(
        query,
        { ...value, payloadHash, updatedAt: now },
        { session, upsert: true },
      );
    return {};
  });
}
module.exports = { applyAccessProjection };
