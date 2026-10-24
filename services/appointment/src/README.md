# Appointment service source layout

- `configs/`: MongoDB connection setup.
- `controllers/`: HTTP handlers for health and slot search.
- `core/`: shared API errors and error middleware.
- `dbs/`: MongoDB indexes.
- `models/`: Mongoose schedule and slot schemas.
- `routes/`: Express URL and middleware wiring.
- `services/`: available-slot query and business rules.
- `utils/`: request correlation ID middleware.
- `app.js`: creates the Express app for runtime and tests.
- `main.js`: connects dependencies and starts the HTTP server.