const { publishOutbox } = require('../../../../mongo/outbox-publisher');
const keys = {
  RequestCharge: 'billing.request-charge.v1',
  QuerySettlement: 'billing.query-settlement.v1',
  SettlementReserved: 'pharmacy.settlement-reserved.v1',
  MedicationHoldChanged: 'pharmacy.medication-hold-changed.v1',
  MedicationDispensed: 'pharmacy.medication-dispensed.v1',
};
function publishPharmacyOutboxBatch(args) {
  return publishOutbox({
    ...args,
    destination: (row) =>
      row.destination_exchange
        ? {
            exchange: row.destination_exchange,
            key: row.destination_key,
          }
        : keys[row.message_type]
          ? {
              exchange:
                row.message_kind === 'COMMAND'
                  ? 'umc.commands.pharmacy.v1'
                  : 'umc.events.pharmacy.v1',
              key: keys[row.message_type],
            }
          : null,
  });
}
module.exports = { publishPharmacyOutboxBatch };
