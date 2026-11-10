const { uuid, integer, staffAccess, failure } = require('./common');
async function listPrescriptions({ connection, page = 1, limit = 20 }) {
  integer(page, 'page');
  integer(limit, 'limit', 100);
  const pipeline = [
    { $match: { state: 'FINAL' } },
    { $sort: { revision: -1 } },
    { $group: { _id: '$prescriptionId', prescription: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$prescription' } },
    {
      $lookup: {
        from: 'dispenses',
        localField: 'prescriptionId',
        foreignField: 'prescriptionId',
        as: 'dispenses',
      },
    },
    { $match: { dispenses: { $size: 0 } } },
    { $project: { _id: 0, dispenses: 0, payloadHash: 0 } },
    { $set: { id: '$prescriptionId' } },
    { $sort: { finalizedAt: 1, prescriptionId: 1 } },
    {
      $facet: {
        items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: 'count' }],
      },
    },
  ];
  const [result] = await connection
    .collection('prescription_projection')
    .aggregate(pipeline)
    .toArray();
  return { items: result.items, total: result.total[0]?.count || 0 };
}
async function prescriptionDetail({
  connection,
  prescriptionId,
  revision,
  holdId,
  authContext,
}) {
  uuid(prescriptionId);
  if (revision != null) integer(revision, 'revision');
  if (holdId != null) uuid(holdId, 'holdId');
  const prescription = await connection
    .collection('prescription_projection')
    .find({
      prescriptionId,
      ...(revision ? { revision } : {}),
    })
    .sort({ revision: -1 })
    .limit(1)
    .next();
  if (!prescription)
    throw failure(
      503,
      'SERVICE_UNAVAILABLE',
      'Prescription projection is unavailable.',
    );
  const query = {
    prescriptionId,
    revision: prescription.revision,
    ...(holdId ? { id: holdId } : {}),
  };
  const holds = await connection
    .collection('medication_holds')
    .find(query)
    .toArray();
  const hold = holds[0];
  const minimal = {
    prescriptionId,
    revision: prescription.revision,
    latestHoldState: hold?.status || 'NOT_HELD',
    dispensedAt: hold?.dispensedAt || null,
  };
  if (authContext.actorType === 'PATIENT') {
    const access = await connection
      .collection('patient_access_projection')
      .findOne({
        patientId: prescription.patientId,
        ownerUserId: authContext.userId,
        active: true,
      });
    if (!access) throw failure(404, 'NOT_FOUND', 'Prescription not found.');
    return { ...minimal, view: 'PATIENT_STATUS' };
  }
  await staffAccess(
    connection,
    authContext.userId,
    undefined,
    authContext.tokenVersion,
  );
  const codes = prescription.itemsSnapshot.map((item) => item.medicineCode);
  const medicine = await connection
    .collection('catalog_projection')
    .find({
      entityType: 'MEDICINE',
      'fullSnapshot.code': { $in: codes },
    })
    .toArray();
  const stock = await connection
    .collection('inventory')
    .find(
      { medicineId: { $in: medicine.map((m) => m.entityId) } },
      { projection: { _id: 0 } },
    )
    .toArray();
  return {
    ...minimal,
    view: 'PHARMACY',
    prescription: {
      id: prescriptionId,
      prescriptionId,
      revision: prescription.revision,
      patientId: prescription.patientId,
      visitId: prescription.visitId,
      state: 'FINAL',
      itemsSnapshot: prescription.itemsSnapshot,
    },
    stock: stock.map((s) => ({ ...s, available: s.onHand - s.reserved })),
    holds: holds.map((h) => ({
      id: h.id,
      prescriptionId,
      revision: h.revision,
      attemptNo: h.attemptNo,
      status: h.status,
      version: h.version,
      expiresAt: h.expiresAt,
      chargeId: h.chargeId,
      chargeSync: h.chargeSync,
      settlementState: h.settlementState,
      amountVnd: h.amountVnd,
    })),
  };
}
module.exports = { listPrescriptions, prescriptionDetail };
