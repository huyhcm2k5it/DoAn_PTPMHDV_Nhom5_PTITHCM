const { randomUUID } = require('node:crypto');
const { uuid, integer, INT_MAX, mutate, failure } = require('./common');
async function receiveStock(args) {
  const {
    connection,
    medicineId,
    quantity,
    batchRef = '',
    principalId,
    now = new Date(),
  } = args;
  uuid(medicineId, 'medicineId');
  integer(quantity, 'quantity');
  if (typeof batchRef !== 'string' || batchRef.length > 200)
    throw failure(400, 'VALIDATION_ERROR', 'Invalid batchRef.');
  return mutate(
    {
      ...args,
      now,
      route: 'PH-002',
      input: { medicineId, quantity, batchRef },
    },
    async (session) => {
      const medicine = await connection
        .collection('catalog_projection')
        .findOne(
          {
            entityType: 'MEDICINE',
            entityId: medicineId,
            active: true,
          },
          { session },
        );
      if (!medicine)
        throw failure(
          503,
          'SERVICE_UNAVAILABLE',
          'Medicine projection is unavailable.',
        );
      const stock = connection.collection('inventory');
      await stock.updateOne(
        { medicineId },
        {
          $setOnInsert: {
            id: randomUUID(),
            onHand: 0,
            reserved: 0,
            version: 0,
          },
        },
        { upsert: true, session },
      );
      const result = await stock.findOneAndUpdate(
        { medicineId, onHand: { $lte: INT_MAX - quantity } },
        { $inc: { onHand: quantity, version: 1 }, $set: { updatedAt: now } },
        { session, returnDocument: 'after' },
      );
      if (!result)
        throw failure(409, 'STATE_CONFLICT', 'Stock would exceed int32.');
      const stockReceiptId = randomUUID();
      await connection.collection('stock_receipts').insertOne(
        {
          id: stockReceiptId,
          receiptKey: principalId + ':' + args.idempotencyKey,
          actorUserId: principalId,
          items: [{ medicineId, quantity, batchRef }],
          receivedAt: now,
        },
        { session },
      );
      await connection.collection('stock_audit').insertOne(
        {
          id: randomUUID(),
          medicineId,
          kind: 'RECEIPT',
          quantity,
          receiptId: stockReceiptId,
          actorUserId: principalId,
          at: now,
        },
        { session },
      );
      return {
        stockReceiptId,
        medicineId,
        onHand: result.onHand,
        available: result.onHand - result.reserved,
      };
    },
  );
}
async function listStock({
  connection,
  page = 1,
  limit = 20,
  code,
  name,
  session,
}) {
  integer(page, 'page');
  integer(limit, 'limit', 100);
  const filter = {};
  if (code || name) {
    const medicines = await connection
      .collection('catalog_projection')
      .find(
        {
          entityType: 'MEDICINE',
          active: true,
        },
        { session },
      )
      .toArray();
    filter.medicineId = {
      $in: medicines
        .filter(
          (m) =>
            (!code || m.fullSnapshot.code === code) &&
            (!name ||
              String(m.fullSnapshot.name)
                .toLowerCase()
                .includes(name.toLowerCase())),
        )
        .map((m) => m.entityId),
    };
  }
  const coll = connection.collection('inventory');
  const total = await coll.countDocuments(filter, { session });
  const rows = await coll
    .find(filter, { session })
    .sort({ medicineId: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();
  const items = [];
  for (const row of rows) {
    const m = await connection
      .collection('catalog_projection')
      .findOne(
        { entityType: 'MEDICINE', entityId: row.medicineId },
        { session },
      );
    items.push({
      medicineId: row.medicineId,
      medicineCode: m?.fullSnapshot.code || '',
      name: m?.fullSnapshot.name || '',
      onHand: row.onHand,
      reserved: row.reserved,
      available: row.onHand - row.reserved,
      version: row.version || 1,
    });
  }
  return { items, total };
}
module.exports = { receiveStock, listStock };
