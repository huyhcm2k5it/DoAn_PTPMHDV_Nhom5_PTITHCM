# appointment

- **Purpose:** Appointment feature or service.
- **Owner:** Quan
- **Add or change:** Keep source code, configuration, migrations, and tests within this folder's scope.

## Node.js stack

Quan uses Express, Mongoose and JavaScript with CommonJS (`require` / `module.exports`). The day-19 storage bootstrap in `src/db/indexes.js` accepts this service’s open Mongoose connection. Runtime Express routes/controllers, schemas/models and the service’s own dependencies will be added during service scaffolding. The foundation test harness lives in `tests/mongo` at repository root.
