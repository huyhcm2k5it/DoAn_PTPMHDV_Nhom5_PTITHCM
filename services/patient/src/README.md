# Patient service source layout

- `auth/`: authentication middleware that builds a verified actor context.
- `configs/`: MongoDB connection setup.
- `controllers/`: HTTP handlers for health and patient routes.
- `core/`: shared API errors and error middleware.
- `dbs/`: MongoDB indexes and patient repository queries.
- `models/`: Mongoose patient schema.
- `routes/`: Express URL and middleware wiring.
- `services/`: patient read and authorization use cases.
- `utils/`: request correlation ID middleware.
- `app.js`: creates the Express app for runtime and tests.
- `main.js`: connects dependencies and starts the HTTP server.