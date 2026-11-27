const { ApiError } = require('../core/errors.js');

// Service-wide evidence, not a watermark proving all upstream events arrived.
// A quiet local DB cannot prove that RabbitMQ or an upstream outbox is empty.
async function getReportSyncStatus(connection) {
  try {
    const [quarantined, retry, outgoing] = await Promise.all([
      connection
        .collection('dead_letters')
        .findOne(
          { consumerName: 'appointment', state: 'QUARANTINED' },
          { projection: { _id: 1 } },
        ),
      connection
        .collection('retry_jobs')
        .findOne(
          { consumerName: 'appointment', state: 'PENDING' },
          { projection: { _id: 1 } },
        ),
      connection
        .collection('outbox')
        .findOne({ published_at: null }, { projection: { _id: 1 } }),
    ]);
    if (quarantined) return 'DEGRADED';
    if (retry || outgoing) return 'PENDING';
    return 'UNKNOWN';
  } catch {
    throw new ApiError(
      503,
      'SERVICE_UNAVAILABLE',
      'Report synchronization evidence is unavailable.',
    );
  }
}
module.exports = { getReportSyncStatus };
