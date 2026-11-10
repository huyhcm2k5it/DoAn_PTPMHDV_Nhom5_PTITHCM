# LAB workspace

Huy owns this feature. It exports `DiagnosticFeature`, `createDiagnosticApi` and types without changing the group's router or shared session.

```tsx
const api = createDiagnosticApi(runtime.transport);
<DiagnosticFeature
  api={api}
  session={{ userId, actorType: 'STAFF', capabilities }}
/>;
```

The host passes the authenticated Identity subject and current capabilities. LAB_TECH can collect, reject with a reason and expectedVersion, and recollect on the same order. LAB_REVIEW can read this increment. Patients and other actors do not load the queue. Backend authorization remains authoritative.

The queue supports state filters and pagination. Detail shows the locally confirmed charge state, specimen history and actor/time audit. Collection stays disabled while payment is pending. Recollection uses DI-006 and never requests another charge. Each write preserves its UUID/body after an ambiguous network failure; the form stays locked until that intent resolves. Conflict messages offer a reload without silently discarding the reason/barcode. Requests abort or ignore stale responses when the order/session changes, and a subject change unmounts the previous patient's detail.

Routes suggested for Quân's shell: `/staff/lab/*`. Hưng supplies the authenticated Gateway transport. `tools/clinical-preview` provides an isolated runner using real Diagnostic on8083; it does not manufacture payment or specimen success.
