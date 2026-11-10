const { consume, uuid, integer, failure, hash } = require('./common');
async function applyPrescriptionFinalized({
  connection,
  message,
  now = new Date(),
}) {
  if (
    message?.messageType !== 'PrescriptionFinalized' ||
    message.messageKind !== 'EVENT' ||
    message.producer !== 'clinical'
  )
    throw failure(
      400,
      'INVALID_MESSAGE',
      'Trusted Clinical FINAL event required.',
    );
  const p = message.payload || {};
  for (const field of ['prescriptionId', 'patientId', 'visitId'])
    uuid(p[field], field);
  integer(p.revision, 'revision');
  if (
    message.aggregateId !== p.prescriptionId ||
    message.aggregateVersion !== p.revision ||
    !Number.isFinite(Date.parse(p.finalizedAt)) ||
    !Array.isArray(p.itemsSnapshot) ||
    !p.itemsSnapshot.length ||
    p.itemsSnapshot.length > 100
  )
    throw failure(400, 'INVALID_MESSAGE', 'Invalid FINAL snapshot.');
  const seen = new Set();
  for (const line of p.itemsSnapshot) {
    if (
      typeof line.medicineCode !== 'string' ||
      !line.medicineCode.trim() ||
      line.medicineCode.length > 100 ||
      seen.has(line.medicineCode)
    )
      throw failure(400, 'INVALID_MESSAGE', 'Medicine codes must be unique.');
    integer(line.quantity, 'quantity');
    seen.add(line.medicineCode);
  }
  return consume(
    { connection, message, now, consumerName: 'pharmacy-prescription' },
    async (session) => {
      const coll = connection.collection('prescription_projection');
      const query = { prescriptionId: p.prescriptionId, revision: p.revision };
      const current = await coll.findOne(query, { session });
      if (current && current.payloadHash !== hash(p))
        throw failure(
          409,
          'PROJECTION_CONFLICT',
          'FINAL revision cannot be changed.',
        );
      if (!current)
        await coll.insertOne(
          {
            id: p.prescriptionId + ':' + p.revision,
            ...p,
            state: 'FINAL',
            linesSnapshot: p.itemsSnapshot,
            payloadHash: hash(p),
            sourceEventId: message.messageId,
            updatedAt: now,
          },
          { session },
        );
      return {};
    },
  );
}
module.exports = { applyPrescriptionFinalized };
