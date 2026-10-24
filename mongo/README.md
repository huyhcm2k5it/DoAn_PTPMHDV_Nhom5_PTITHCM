# mongo

- **Purpose:** MongoDB configuration.
- **Owner:** Team
- **Add or change:** Keep MongoDB configuration and related resources here.

## Shared Node.js primitives

`storage.js`, `transaction.js` and `service-users.js` use JavaScript/CommonJS. They receive a Mongoose connection supplied by an owner service, and do not open a shared default application connection. Collection/index DDL and DB-user commands intentionally use the connection’s database APIs; domain CRUD will use the owner’s Mongoose models. `transaction.js` uses `connection.transaction()` so aborted model saves reset their document state.
