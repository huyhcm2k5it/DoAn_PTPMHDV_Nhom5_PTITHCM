/** The callback may be retried. Use its session for every local operation. */
async function withMongoTransaction(connection, work) {
  return connection.transaction(work, {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
    readPreference: 'primary',
    maxCommitTimeMS: 5000,
    timeoutMS: 15000,
  });
}

module.exports = { withMongoTransaction };
