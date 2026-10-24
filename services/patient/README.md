# Patient service

Owner: Quân. Runtime: Node.js 24, Express 5, Mongoose 9 and JavaScript CommonJS.

## Implemented

- GET /health/live and GET /health/ready.
- GET /api/v1/patients?page=1&limit=20, scoped to the verified PATIENT subject.
- GET /api/v1/patients/{patientId}, owner lookup plus an injected authorization policy for verified STAFF/DOCTOR scopes.
- Owner-only Mongo URI guard and the patient_db storage/index bootstrap.
- Generic auth middleware fails closed. The production entrypoint does not install a JWT verifier until the Identity/Gateway handoff arrives.

## Local commands

Run npm ci, npm run check, npm test and npm start from this directory. Set MONGODB_URI to a URI selecting patient_db. Health reports not-ready when the owner database is unavailable. The full owner/API integration tests are in tests/mongo.