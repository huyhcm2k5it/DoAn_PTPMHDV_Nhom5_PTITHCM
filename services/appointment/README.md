# Appointment service

Owner: Quân. Runtime: Node.js 24, Express 5, Mongoose 9 and JavaScript CommonJS.

## Implemented

- GET /health/live and GET /health/ready.
- Public GET /api/v1/slots/available with UUID/date validation, an Asia/Ho_Chi_Minh day window, schedule filtering and remaining-capacity calculation.
- Owner-only Mongo URI guard and the appointment_db storage/index bootstrap.

AP-004 is only a read query; it does not reserve a slot. Gateway route/rate limiting and Catalog-owned doctor/service projection remain integration dependencies.

Run npm ci, npm run check, npm test and npm start from this directory. Set MONGODB_URI to a URI selecting appointment_db.