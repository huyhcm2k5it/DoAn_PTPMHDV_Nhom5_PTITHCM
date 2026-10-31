# Doctor workbench

Owner: Huy. Week 2 covers CL-001–004: own visits, asynchronous start status and four-field draft editing. Exported `ClinicalFeature` and `createClinicalApi` are ready for Quân's shell; they do not register routes themselves.

```tsx
const api = createClinicalApi(runtime.transport);
<ClinicalFeature
  api={api}
  session={{ userId: authenticatedSubject, actorType: "DOCTOR" }}
  selectedTicket={{ ticketId, doctorId, expectedTicketVersion }}
/>
```

Hưng supplies the authenticated JWT subject and Gateway transport, including credentials and the 401 redirect. No tokens are stored by the feature. Use a stable transport that obtains current credentials. The session userId is required so a subject change unmounts all draft/operation state. Quân supplies selectedTicket from the trusted queue UI; the component does not ask patients to type internal IDs or send patientId in CL-002.

The feature calls only `/api/v1` paths. A start result stays PENDING until polling CL-001 reports ACCEPTED with a visit ID; rejected claims never open a visit. Worklist and detail requests abort/ignore stale responses. Draft saves include all four fields and expectedVersion, preserve the same UUID/body for a network retry, retain local text on 409 and offer an explicit reload. A signed visit is read-only. Loading, empty, unavailable, 401/403, pending and conflict states are visible.

Route suggestions: `/doctor/worklist` and a host-selected visit flow. The feature itself owns no global router/session/shared UI files. Integration with Quân's route registry and Hưng's live Identity/Gateway remains to be checked against their final contracts.

Run `npm ci`, `npm test` and `npm run build` inside `tools/clinical-preview` for its isolated test/build runner.
