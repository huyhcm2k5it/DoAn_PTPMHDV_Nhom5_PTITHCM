const { entity, installStorage, requiredFields, technicalStorage } = require('../../../../mongo/storage.js');

const pharmacyStorage = [
  {
    ...entity('inventory', [{ name: 'uq_inventory_medicine', key: { medicineId: 1 }, unique: true }]),
    validator: requiredFields(['id', 'medicineId', 'onHand', 'reserved'], {
      onHand: { bsonType: ['int', 'long'], minimum: 0 },
      reserved: { bsonType: ['int', 'long'], minimum: 0 },
    }, { $expr: { $lte: ['$reserved', '$onHand'] } }),
  },
  entity('stock_receipts', [{ name: 'uq_stock_receipt_key', key: { receiptKey: 1 }, unique: true }], ['receiptKey']),
  entity('prescription_projection', [{ name: 'uq_prescription_revision', key: { prescriptionId: 1, revision: 1 }, unique: true }], ['prescriptionId', 'revision']),
  entity('medication_holds', [
    { name: 'uq_medication_hold_prescription_revision', key: { prescriptionId: 1, revision: 1 }, unique: true },
    { name: 'ix_medication_hold_expiry', key: { status: 1, expiresAt: 1 } },
  ], ['prescriptionId', 'revision']),
  entity('dispenses', [
    { name: 'uq_dispense_hold', key: { holdId: 1 }, unique: true },
    { name: 'uq_dispense_prescription_revision', key: { prescriptionId: 1, revision: 1 }, unique: true },
  ], ['holdId', 'prescriptionId', 'revision']),
  { name: 'command_results', validator: requiredFields(['command_id']), indexes: [
    { name: 'uq_command_result', key: { command_id: 1 }, unique: true },
  ] },
  ...technicalStorage,
];

async function ensurePharmacyStorage(connection) { await installStorage(connection, pharmacyStorage); }

module.exports = { pharmacyStorage, ensurePharmacyStorage };
