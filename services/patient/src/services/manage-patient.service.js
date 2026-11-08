const { createHash, randomUUID } = require('node:crypto');
const { withMongoTransaction } = require('../../../../mongo/transaction.js');
const { ApiError } = require('../core/errors.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value, field) {
  if (!UUID.test(value || '')) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a UUID.`);
}

function assertProjection(authContext, projection) {
  if (!projection || projection.status !== 'ACTIVE')
    throw new ApiError(503, 'AUTH_PROJECTION_UNAVAILABLE', 'Identity access projection is unavailable.');
  if (projection.tokenVersion !== authContext.tokenVersion)
    throw new ApiError(403, 'FORBIDDEN', 'Token has been revoked.');
}

function cleanPatient(patient) {
  if (!patient) return null;
  const { _id, ...data } = patient;
  return data;
}

function validateProfile(body) {
  const value = body || {};
  if (!value.fullName || typeof value.fullName !== 'string' || value.fullName.trim().length < 2)
    throw new ApiError(400, 'VALIDATION_ERROR', 'fullName is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.birthDate || ''))
    throw new ApiError(400, 'VALIDATION_ERROR', 'birthDate must be YYYY-MM-DD.');
  if (!['SELF', 'OTHER'].includes(value.relation))
    throw new ApiError(400, 'VALIDATION_ERROR', 'relation must be SELF or OTHER.');
  return {
    fullName: value.fullName.trim(),
    birthDate: value.birthDate,
    relation: value.relation,
    sex: value.sex || undefined,
    bhytSelfDeclared: value.bhytSelfDeclared || undefined,
    contactPhone: value.contactPhone || undefined,
    address: value.address || undefined,
  };
}

async function mutatePatient({ connection, authContext, idempotencyKey, route, input, now }, work) {
  assertUuid(idempotencyKey, 'Idempotency-Key');
  const records = connection.collection('idempotency_records');
  const identity = { principal_id: authContext.userId, route, key: idempotencyKey };
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
  const replay = async session => {
    const row = await records.findOne(identity, { session });
    if (!row) return null;
    if (row.request_hash !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Key identifies another request.');
    return row.response;
  };
  try {
    return await withMongoTransaction(connection, async session => {
      const projection = await connection.collection('user_access_projection').findOne({ userId: authContext.userId }, { session });
      assertProjection(authContext, projection);
      const old = await replay(session); if (old) return old;
      const response = await work(session);
      await records.insertOne({ ...identity, request_hash: fingerprint, response, created_at: now }, { session });
      return response;
    });
  } catch (error) { if (error.code === 11000) { const old = await replay(); if (old) return old; } throw error; }
}

async function createPatient({ connection, Patient, authContext, body, idempotencyKey, requestId = randomUUID(), correlationId = requestId, createId = randomUUID, now = new Date() }) {
  const projection = await connection.collection('user_access_projection').findOne({ userId: authContext.userId });
  assertProjection(authContext, projection);
  const isReception = authContext.actorType === 'STAFF' && projection.capabilities?.includes('RECEPTION');
  if (!['PATIENT', 'STAFF'].includes(authContext.actorType) || (authContext.actorType === 'STAFF' && !isReception))
    throw new ApiError(403, 'FORBIDDEN', 'Actor cannot create patient profiles.');
  const profile = validateProfile(body);
  const ownerUserId = isReception ? body.ownerUserId : authContext.userId;
  assertUuid(ownerUserId, 'ownerUserId');
  if (!isReception && body.ownerUserId && body.ownerUserId !== authContext.userId) throw new ApiError(403, 'FORBIDDEN', 'Owner comes from authenticated identity.');
  if (isReception) {
    const owner = await connection.collection('user_access_projection').findOne({ userId: ownerUserId });
    if (!owner || owner.status !== 'ACTIVE' || owner.actorType !== 'PATIENT') throw new ApiError(403, 'ACCOUNT_PROOF_REQUIRED', 'A verified active patient account is required.');
  }
  const patient = {
    id: createId(),
    ownerUserId,
    ...profile,
    active: true,
    version: 1,
    policyVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  return mutatePatient({ connection, authContext, idempotencyKey, route: 'POST /api/v1/patients', input: body, now }, async (session) => {
    await Patient.create([patient], { session });
    await connection.collection('outbox').insertOne({
      message_id: createId(),
      message_kind: 'EVENT',
      message_type: 'PatientAccessChanged',
      schema_version: 1,
      producer: 'patient',
      aggregate_id: patient.id,
      aggregate_version: 1,
      correlation_id: correlationId,
      request_id: requestId,
      causation_id: requestId,
      occurred_at: now,
      payload: {
        patientId: patient.id,
        ownerUserId,
        active: true,
        policyVersion: 1,
      },
    }, { session });
    await connection.collection('profile_audit').insertOne({ id: randomUUID(), patientId: patient.id, actorUserId: authContext.userId, action: 'CREATED', version: 1, at: now }, { session });
    return cleanPatient(patient);
  });
}

async function updatePatient({ connection, Patient, authContext, patientId, body, expectedVersion, idempotencyKey, requestId = randomUUID(), correlationId = requestId, now = new Date() }) {
  assertUuid(patientId, 'patientId');
  if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) < 1)
    throw new ApiError(400, 'VALIDATION_ERROR', 'expectedVersion must be a positive integer.');
  const projection = await connection.collection('user_access_projection').findOne({ userId: authContext.userId });
  assertProjection(authContext, projection);
  const isReception = authContext.actorType === 'STAFF' && projection.capabilities?.includes('RECEPTION');
  if (!['PATIENT', 'STAFF'].includes(authContext.actorType) || (authContext.actorType === 'STAFF' && !isReception))
    throw new ApiError(403, 'FORBIDDEN', 'Actor cannot update patient profiles.');
  return mutatePatient({ connection, authContext, idempotencyKey, route: 'PATCH /api/v1/patients/' + patientId, input: { body, expectedVersion }, now }, async (session) => {
    const current = await Patient.findOne({ id: patientId, active: { $ne: false } }).session(session).lean();
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Patient record not found.');
    if (!isReception && current.ownerUserId !== authContext.userId)
      throw new ApiError(403, 'FORBIDDEN', 'Actor is not the patient owner.');
    if (current.version !== Number(expectedVersion)) throw new ApiError(409, 'VERSION_CONFLICT', 'Patient changed.');
    const updates = { ...validateProfile({ ...current, ...body }), updatedAt: now };
    const changed = await Patient.updateOne(
      { id: patientId, version: current.version, active: { $ne: false } },
      { $set: updates, $inc: { version: 1, policyVersion: 1 } },
      { session },
    );
    if (!changed.modifiedCount) throw new ApiError(409, 'VERSION_CONFLICT', 'Patient changed.');
    const next = { ...current, ...updates, version: current.version + 1, policyVersion: current.policyVersion + 1 };
    await connection.collection('outbox').insertOne({
      message_id: randomUUID(),
      message_kind: 'EVENT',
      message_type: 'PatientAccessChanged',
      schema_version: 1,
      producer: 'patient',
      aggregate_id: patientId,
      aggregate_version: next.policyVersion,
      correlation_id: correlationId,
      request_id: requestId,
      causation_id: requestId,
      occurred_at: now,
      payload: {
        patientId,
        ownerUserId: next.ownerUserId,
        active: next.active !== false,
        policyVersion: next.policyVersion,
      },
    }, { session });
    await connection.collection('profile_audit').insertOne({ id: randomUUID(), patientId, actorUserId: authContext.userId, action: 'UPDATED', version: next.version, at: now }, { session });
    return cleanPatient(next);
  });
}

async function searchPatients({ repository, authContext, projection, query, page = 1, limit = 20 }) {
  assertProjection(authContext, projection);
  if (authContext.actorType !== 'STAFF' || !projection.capabilities?.includes('RECEPTION'))
    throw new ApiError(403, 'FORBIDDEN', 'RECEPTION capability is required.');
  const q = String(query || '').trim();
  if (q.length < 2) throw new ApiError(400, 'VALIDATION_ERROR', 'q must contain at least 2 characters.');
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);
  if (!Number.isInteger(parsedPage) || parsedPage < 1 || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)
    throw new ApiError(400, 'VALIDATION_ERROR', 'page/limit is invalid.');
  return repository.search(q, { skip: (parsedPage - 1) * parsedLimit, limit: parsedLimit });
}

module.exports = { createPatient, updatePatient, searchPatients, validateProfile, UUID };
