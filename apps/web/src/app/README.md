# Web shell Q07

The shell owns the menu and routes for Quân's Patient and Appointment screens. It accepts the Identity/Gateway runtime from Hưng through `window.umcCareWebRuntime`; this app does not store access tokens or create a second session store.

The runtime contract exposes the existing shared transport, the verified session snapshot used for UI decisions, and an `onUnauthorized` callback owned by Identity. The transport must call Envoy using `/api/v1/...`, attach the bearer according to Hưng's contract, and return the raw `Response` so feature clients can read the standard envelope. The backend remains responsible for authorization.

Current screens:
- `/patient/profiles`: owner-scoped list and pagination.
- `/patient/profiles/:patientId`: profile detail.
- `/patient/appointments/new`: catalog-backed filters and public slot lookup only; it does not book or hold a slot.

Until the shared adapter is loaded, API calls show an explicit connection error; no mock data or fake session is included.