const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

async function measure({ url, token, total = 100, concurrency = 30 }) {
  const endpoint = new URL(url);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('HTTP URL required.');
  let cursor = 0;
  const results = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, async () => {
      while (cursor < total) {
        const index = cursor++;
        const started = performance.now();
        try {
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: token ? { Authorization: 'Bearer ' + token } : {},
            signal: AbortSignal.timeout(10000),
          });
          await response.arrayBuffer();
          results.push({ index, ms: performance.now() - started, status: response.status });
        } catch {
          results.push({ index, ms: performance.now() - started, status: 0 });
        }
      }
    }),
  );
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const p95Ms = times[Math.ceil(total * 0.95) - 1];
  const errors = results.filter((r) => r.status < 200 || r.status >= 300).length;
  return {
    measuredAt: new Date().toISOString(),
    method: 'GET',
    total,
    concurrency,
    p95Ms,
    errors,
    passed: errors === 0 && p95Ms < 2000,
    scope:
      'Read latency only. Cache hit rate, projection lag and recovery require separate evidence.',
    results,
  };
}
if (require.main === module) {
  (async () => {
    if (!process.env.UMC_READ_URL)
      throw new Error('Set UMC_READ_URL to an authorized read-only Gateway endpoint.');
    const result = await measure({
      url: process.env.UMC_READ_URL,
      token: process.env.UMC_TEST_TOKEN,
    });
    const output = path.resolve(__dirname, '../../.runtime/evidence/read-latency.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(
      JSON.stringify({ output, total: result.total, p95Ms: result.p95Ms, errors: result.errors }),
    );
    if (!result.passed) process.exitCode = 1;
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { measure };
