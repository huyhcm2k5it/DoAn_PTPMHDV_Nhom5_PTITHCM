# Clinical development runner

Standalone runner for Huy's exported doctor feature. It uses the real Clinical API; it does not fabricate claim results, authentication or visits.

```powershell
cd tools/clinical-preview
npm ci
npm test
npm run build
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8082`. Start PostgreSQL, migrate/seed Clinical, configure the API's RSA public key, and supply a matching test JWT from Identity. The developer panel accepts a bearer token in memory and its subject; it is not a production login. The selected ticket uses the explicit fake fixture. Starting it remains PENDING until a genuine Appointment claim response is delivered.

The tests cover pending/accepted/rejected states, retry keys across credential-transport refreshes, retaining unsaved text on conflicts, patient role isolation and HTTP errors with correlationId. The production host imports the feature directly rather than this runner.
