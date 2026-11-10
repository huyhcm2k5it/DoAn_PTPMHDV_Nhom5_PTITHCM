const { createHash } = require('node:crypto');
const { ApiError } = require('../core/errors');
const PREFIX = 'umc:appointment:available:v1:';
function createSlotCache({
  redis,
  timeoutMs = 100,
  bulkheadLimit = 20,
  now = Date.now,
} = {}) {
  let failures = 0,
    openUntil = 0,
    active = 0;
  const keys = new Set();
  async function redisCall(work) {
    if (!redis || now() < openUntil) return null;
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(work),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('CACHE_TIMEOUT')),
            timeoutMs,
          );
        }),
      ]);
      failures = 0;
      return result;
    } catch {
      if (++failures >= 5) {
        openUntil = now() + 15000;
        failures = 0;
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async read(date, filters, load) {
      const normalized = Object.fromEntries(
        Object.keys(filters)
          .sort()
          .map((k) => [k, filters[k]]),
      );
      const key =
        PREFIX +
        date +
        ':' +
        createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
      const cached = await redisCall(() => redis.get(key));
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (
            parsed.availableIsAdvisory === true &&
            Array.isArray(parsed.items) &&
            parsed.asOf
          )
            return parsed;
        } catch {}
      }
      if (active >= bulkheadLimit)
        throw new ApiError(
          503,
          'SLOT_READ_OVERLOADED',
          'Slot availability is busy. Retry shortly.',
        );
      active++;
      try {
        const result = {
          items: await load(),
          asOf: new Date(now()).toISOString(),
          availableIsAdvisory: true,
        };
        keys.add(key);
        // Keep key tracking bounded even if invalidation cannot reach Redis.
        if (keys.size > 10000) keys.delete(keys.values().next().value);
        await redisCall(() =>
          redis.set(key, JSON.stringify(result), { EX: 3 }),
        );
        return result;
      } finally {
        active--;
      }
    },
    async invalidate() {
      await redisCall(async () => {
        if (redis.scanIterator) {
          for await (const batch of redis.scanIterator({
            MATCH: PREFIX + '*',
            COUNT: 100,
          })) {
            const found = Array.isArray(batch) ? batch : [batch];
            if (found.length) await redis.del(found);
          }
        } else if (keys.size) await redis.del([...keys]);
      });
      keys.clear();
    },
  };
}
let defaultCache = createSlotCache();
function setSlotCache(cache) {
  defaultCache = cache;
}
function getSlotCache() {
  return defaultCache;
}
module.exports = { createSlotCache, setSlotCache, getSlotCache, PREFIX };
