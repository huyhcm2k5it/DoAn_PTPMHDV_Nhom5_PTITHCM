const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Billing events are broadcast to all source owners; commands remain targeted.
async function isForeignBillingEvent(connection, message, owner, collection, session) {
  if (
    message.messageKind !== 'EVENT' ||
    message.producer !== 'billing' ||
    message.schemaVersion !== 1
  )
    return false;
  const p = message.payload || {};
  if (!uuid.test(p.sourceId || '')) return false;
  const known = ['APPOINTMENT', 'MED_HOLD', 'PHARMACY', 'LAB_ORDER'];
  if (known.includes(p.sourceType)) return !owner.includes(p.sourceType);
  // SettlementDecision has no sourceType in v1. A decision can only follow
  // a source owner's existing reservation; absence here identifies another owner.
  if (message.messageType === 'SettlementDecision' && p.sourceType == null) {
    const source = await connection
      .collection(collection)
      .findOne({ id: p.sourceId }, { session, projection: { _id: 1 } });
    return !source;
  }
  return false;
}
module.exports = { isForeignBillingEvent };
