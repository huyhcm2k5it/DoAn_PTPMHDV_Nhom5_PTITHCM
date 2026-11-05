const test = require('node:test');
const assert = require('node:assert/strict');
const { RETRY_DELAYS_MS, routeFor } = require('../src/workers/amqp-runtime.js');

test('Appointment worker routes all agreed command/event families', () => {
  assert.equal(routeFor({ messageKind: 'COMMAND', messageType: 'ClaimQueueTicket' }), 'claim');
  assert.equal(routeFor({ messageKind: 'COMMAND', messageType: 'ReserveSettlement' }), 'reserve');
  assert.equal(routeFor({ messageKind: 'EVENT', messageType: 'ChargePaid' }), 'billing');
  assert.equal(routeFor({ messageKind: 'EVENT', messageType: 'VisitSigned' }), 'clinical');
  assert.equal(routeFor({ messageKind: 'EVENT', messageType: 'IdentityAccessChanged' }), 'projection');
  assert.equal(routeFor({ messageKind: 'EVENT', messageType: 'CatalogChanged' }), 'catalog');
  assert.deepEqual(RETRY_DELAYS_MS, [5000, 15000, 60000]);
  assert.throws(() => routeFor({ messageType: 'Unknown' }), /Unsupported Appointment message/);
});
