# Mongo and API contract tests

This standalone JavaScript/CommonJS package verifies storage constraints, Mongo transactions and the Patient/AP-004 HTTP read paths using a temporary authenticated one-member MongoDB replica set.

From this directory:

    npm ci --ignore-scripts
    npm run check
    npm test

Tests require Node.js 24.x and reuse the MongoDB 8.0.16 binary cache. The test suite does not use Docker. The API verifier fixture exists only in this test harness; the production Patient entrypoint fails closed until the Identity/Gateway verifier is supplied.