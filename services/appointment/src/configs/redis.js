const {
  createSlotCache,
  setSlotCache,
} = require('../services/slot-cache.service');
async function configureSlotCache({
  url = process.env.APPOINTMENT_REDIS_URL,
} = {}) {
  if (!url) return null;
  const { createClient } = require('redis');
  const redis = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 100,
      reconnectStrategy: (retries) => Math.min(1000, retries * 100),
    },
  });
  redis.on('error', () => {});
  // Availability reads already have a bounded DB fallback during reconnect.
  redis.connect().catch(() => {});
  setSlotCache(
    createSlotCache({
      redis,
      bulkheadLimit: Number(process.env.SLOT_DB_BULKHEAD_LIMIT || 20),
    }),
  );
  return redis;
}
module.exports = { configureSlotCache };
