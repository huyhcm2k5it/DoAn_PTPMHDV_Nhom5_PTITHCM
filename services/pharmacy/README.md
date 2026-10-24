# Pharmacy service

Owner: Quân. Runtime: Node.js 24, Express 5, Mongoose 9 and JavaScript CommonJS.

## Implemented

- GET /health/live and GET /health/ready.
- Owner-only Mongo URI guard and the pharmacy_db storage/index bootstrap.
- Graceful shutdown for the HTTP server and Mongoose connection.

Pharmacy business endpoints are not part of the 25/10 Gate A target. Run npm ci, npm run check, npm test and npm start from this directory. Set MONGODB_URI to a URI selecting pharmacy_db.