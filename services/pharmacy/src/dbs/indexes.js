const {
  entity,
  installStorage,
  requiredFields,
  technicalStorage,
} = require('../../../../mongo/storage.js');

const pharmacyStorage = [
  {
    ...entity('inventory', [
      { name: 'uq_inventory_medicine', key: { medicineId: 1 }, unique: true },
    ]),
    validator: requiredFields(
      ['id', 'medicineId', 'onHand', 'reserved'],
      {
        onHand: { bsonType: ['int', 'long'], minimum: 0 },
        reserved: { bsonType: ['int', 'long'], minimum: 0 },
      },
      { $expr: { $lte: ['$reserved', '$onHand'] } },
    ),
  },
  entity(
    'stock_receipts',
    [{ name: 'uq_stock_receipt_key', key: { receiptKey: 1 }, unique: true }],
    ['receiptKey'],
  ),
  entity(
    'prescription_projection',
    [
      {
        name: 'uq_prescription_revision',
        key: { prescriptionId: 1, revision: 1 },
        unique: true,
      },
    ],
    ['prescriptionId', 'revision'],
  ),
  entity(
    'medication_holds',
    [
      {
        name: 'uq_medication_hold_prescription_revision',
        key: { prescriptionId: 1, revision: 1 },
        unique: true,
      },
      { name: 'ix_medication_hold_expiry', key: { status: 1, expiresAt: 1 } },
    ],
    ['prescriptionId', 'revision'],
  ),
  entity(
    'dispenses',
    [
      { name: 'uq_dispense_hold', key: { holdId: 1 }, unique: true },
      {
        name: 'uq_dispense_prescription_revision',
        key: { prescriptionId: 1, revision: 1 },
        unique: true,
      },
    ],
    ['holdId', 'prescriptionId', 'revision'],
  ),
  {
    name: 'command_results',
    validator: requiredFields(['command_id']),
    indexes: [
      { name: 'uq_command_result', key: { command_id: 1 }, unique: true },
    ],
  },
  entity('stock_audit', [
    { name: 'ix_stock_audit_medicine', key: { medicineId: 1, at: -1 } },
  ]),
  {
    name: 'retry_jobs',
    indexes: [
      { name: 'uq_retry_job', key: { id: 1 }, unique: true },
      {
        name: 'ix_retry_due',
        key: { consumerName: 1, state: 1, nextAttemptAt: 1, leaseUntil: 1 },
      },
    ],
  },
  {
    name: 'dead_letters',
    indexes: [{ name: 'uq_dead_letter', key: { id: 1 }, unique: true }],
  },
  {
    name: 'settlement_decisions',
    indexes: [
      {
        name: 'uq_settlement_decision',
        key: {
          sourceId: 1,
          sourceRevision: 1,
          settlementId: 1,
          decisionVersion: 1,
        },
        unique: true,
      },
    ],
  },
  {
    name: 'user_access_projection',
    indexes: [
      { name: 'uq_user_access_projection', key: { userId: 1 }, unique: true },
    ],
  },
  {
    name: 'patient_access_projection',
    indexes: [
      {
        name: 'uq_patient_access_projection',
        key: { patientId: 1 },
        unique: true,
      },
    ],
  },
  {
    name: 'catalog_projection',
    indexes: [
      { name: 'uq_catalog_entity', key: { entityKey: 1 }, unique: true },
      {
        name: 'ix_catalog_item',
        key: { entityType: 1, 'fullSnapshot.itemId': 1 },
      },
      {
        name: 'ix_catalog_code',
        key: { entityType: 1, 'fullSnapshot.code': 1 },
      },
    ],
  },
  {
    name: 'projection_checkpoints',
    indexes: [
      {
        name: 'uq_projection_checkpoint',
        key: { projectionName: 1 },
        unique: true,
      },
    ],
  },
  ...technicalStorage,
];

async function ensurePharmacyStorage(connection) {
  await installStorage(connection, pharmacyStorage);
}

module.exports = { pharmacyStorage, ensurePharmacyStorage };
