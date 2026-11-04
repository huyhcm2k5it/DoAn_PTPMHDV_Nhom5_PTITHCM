# Doctor workbench

Owner: Huy. Covers CL-001–010: own visits, asynchronous start status, draft notes, LAB requests, draft prescriptions, visit completion and prescription finalization. Exported `ClinicalFeature` and `createClinicalApi` are ready for Quân's shell; they do not register routes themselves.

```tsx
const api = createClinicalApi(runtime.transport, {
  authorizationLease: (action, resourceId) => runtime.getAuthorizationLease(action, resourceId),
});
<ClinicalFeature
  api={api}
  session={{ userId: authenticatedSubject, actorType: "DOCTOR" }}
  selectedTicket={{ ticketId, doctorId, expectedTicketVersion }}
/>
```

Hưng supplies the authenticated JWT subject and Gateway transport, including credentials and the 401 redirect. No tokens are stored by the feature. Use a stable transport that obtains current credentials. The session userId is required so a subject change unmounts all draft/operation state. Quân supplies selectedTicket from the trusted queue UI; the component does not ask patients to type internal IDs or send patientId in CL-002.

The feature calls only `/api/v1` paths. A start result stays PENDING until polling CL-001 reports ACCEPTED with a visit ID; rejected claims never open a visit. Worklist and detail requests abort/ignore stale responses. Draft saves include all four fields and expectedVersion, preserve the same UUID/body for a network retry, retain local text on 409 and offer an explicit reload. A signed visit is read-only. Loading, empty, unavailable, 401/403, pending and conflict states are visible.

The treatment panel reads active medicines/tests from Catalog through the injected transport. LAB submission sends test IDs/revisions only and polls CL-003 while the registry is PENDING, without resetting text in the note editor. A created order is still unresolved for visit signing. Prescription edits and deletion carry the last observed version. Visit completion and prescription FINAL are separate operations with separate outcomes; a successful first operation never implies the second succeeded.

`authorizationLease` asks the host for a fresh Identity lease for `CL-009` or `CL-010`, and the adapter attaches `X-Authorization-Lease`. The callback is optional only because a host transport may already attach that header centrally; the server still requires a valid lease. After an ambiguous failure or expired lease, retry keeps the original mutation UUID and body while obtaining a current lease. A definitive conflict retains entered text until the doctor explicitly reloads.

Route suggestions: `/doctor/worklist` and a host-selected visit flow. The feature itself owns no global router/session/shared UI files. Integration with Quân's route registry and Hưng's live Identity/Gateway remains to be checked against their final contracts.

Run `npm ci`, `npm test` and `npm run build` inside `tools/clinical-preview` for its isolated test/build runner.
