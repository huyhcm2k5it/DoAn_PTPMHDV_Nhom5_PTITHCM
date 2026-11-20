# Clinical development runner

Standalone runner for Huy's exported doctor feature. It uses the real Clinical API; it does not fabricate claim results, authentication or visits.

```powershell
cd apps/web
npm ci
cd ../..
cd tools/clinical-preview
npm ci
npm test
npm run build
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8008`. Start PostgreSQL, migrate/seed Clinical, configure the API's RSA public key, and supply a matching test JWT from Identity. The developer panel accepts a bearer token in memory and its subject; it is not a production login. The selected ticket uses the explicit fake fixture. Starting it remains PENDING until a genuine Appointment claim response is delivered.

The tests cover pending/accepted/rejected states, retry keys across credential-transport refreshes, retaining unsaved text on conflicts, patient role isolation and HTTP errors with correlationId. The production host imports the feature directly rather than this runner.

The runner also supports LAB_TECH and independent LAB_REVIEW workflows, including result entry, review, rework and publication. Select the view in the development panel and supply a real token with matching subject/capabilities. Catalog proxies to8007, Clinical to8008 and Diagnostic to8009. Results and specimens proxy to Diagnostic; patient published-results also proxy to Diagnostic, while medical-records proxy to Clinical. Supply the current Identity lease for the specific protected action; the panel does not mint or grant permissions. Tokens and leases remain in memory only. LAB registry is polled while PENDING or CREATED, and payment/refund states come from Diagnostic projections.

The runner resolves React, React DOM, icons and testing-library through `apps/web/node_modules` to use one React instance for shared feature components. Install dependencies in both directories before running tests or the standalone build. The shared application at `apps/web` remains the main frontend; this runner is for isolated development and tests.
