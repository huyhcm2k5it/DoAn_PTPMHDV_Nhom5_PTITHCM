const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app.js');
test('health live and readiness reflect the database dependency', async (t) => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  const base = 'http://127.0.0.1:' + server.address().port;
  const live = await fetch(base + '/health/live');
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'live' });
  const ready = await fetch(base + '/health/ready');
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { status: 'not_ready' });
});