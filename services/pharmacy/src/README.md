# Pharmacy service source layout

- `configs/`: MongoDB connection setup.
- `controllers/`: health HTTP handlers.
- `core/`: shared API errors and error middleware.
- `dbs/`: MongoDB indexes and storage bootstrap.
- `routes/`: health route wiring.
- `utils/`: request correlation ID middleware.
- `app.js`: creates the Express app for runtime and tests.
- `main.js`: connects dependencies and starts the HTTP server.