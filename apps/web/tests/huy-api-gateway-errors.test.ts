import { describe, expect, it } from 'vitest';
import { createCatalogApi } from '../src/features/catalog/api';
import { createClinicalApi } from '../src/features/clinical/api';
import { createDiagnosticApi } from '../src/features/diagnostic/api';
const adapters = [
  [
    'Catalog',
    (transport: () => Promise<Response>) => () =>
      createCatalogApi(transport).departments(),
  ],
  [
    'Clinical',
    (transport: () => Promise<Response>) => () =>
      createClinicalApi(transport).detail('visit'),
  ],
  [
    'Diagnostic',
    (transport: () => Promise<Response>) => () =>
      createDiagnosticApi(transport).detail('order'),
  ],
] as const;
for (const [name, create] of adapters) {
  describe(`${name} Gateway failures`, () => {
    for (const [status, code] of [
      [401, 'UNAUTHENTICATED'],
      [403, 'FORBIDDEN'],
      [503, 'SERVICE_UNAVAILABLE'],
    ] as const) {
      it(`preserves ${status} semantics when Gateway returns plain text`, async () => {
        const call = create(
          async () =>
            new Response('Gateway error', {
              status,
              headers: { 'X-Correlation-ID': 'gateway-trace' },
            }),
        );
        await expect(call()).rejects.toMatchObject({
          status,
          code,
          correlationId: 'gateway-trace',
        });
      });
    }
    it('preserves server domain codes and correlation IDs', async () => {
      const call = create(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'AUTHZ_LEASE_EXPIRED', message: 'Lease expired' },
              meta: { correlationId: 'server-trace' },
            }),
            { status: 401, headers: { 'X-Correlation-ID': 'gateway-trace' } },
          ),
      );
      await expect(call()).rejects.toMatchObject({
        status: 401,
        code: 'AUTHZ_LEASE_EXPIRED',
        correlationId: 'server-trace',
      });
    });
  });
}
