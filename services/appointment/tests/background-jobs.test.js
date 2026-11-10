const test = require('node:test');
const assert = require('node:assert/strict');
const { startBackgroundJobs } = require('../../../mongo/background-jobs');
test('background jobs run without overlap and stop cleanly', async () => {
  let runs = 0,
    active = 0,
    peak = 0;
  const runner = startBackgroundJobs({
    intervalMs: 2,
    jobs: [
      async () => {
        runs++;
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 8));
        active--;
      },
    ],
    onError: (error) => {
      throw error;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await runner.close();
  const stopped = runs;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(runs > 0);
  assert.equal(peak, 1);
  assert.equal(runs, stopped);
  assert.equal(active, 0);
});
