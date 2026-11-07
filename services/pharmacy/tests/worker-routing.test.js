const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatchMessage, retryId } = require('../src/workers/amqp-runtime');
test('broker identity includes exchange key producer and version', async () => {
  const m = {
    messageId: 'test',
    messageKind: 'EVENT',
    messageType: 'PrescriptionFinalized',
    producer: 'clinical',
    schemaVersion: 1,
    payload: {},
  };
  await assert.rejects(
    dispatchMessage({
      message: m,
      exchange: 'umc.events.billing.v1',
      routingKey: 'clinical.prescription-finalized.v1',
    }),
    /route/i,
  );
  await assert.rejects(
    dispatchMessage({
      message: { ...m, producer: 'browser' },
      exchange: 'umc.events.clinical.v1',
      routingKey: 'clinical.prescription-finalized.v1',
    }),
    /producer/i,
  );
  assert.notEqual(
    retryId('umc.events.billing.v1', 'billing.charge-paid.v1'),
    retryId('umc.events.billing.v1', 'billing.charge-prepared.v1'),
  );
});
