import { describe, expect, it, vi } from 'vitest';
import { createCatalogApi, ApiError } from '../src/features/catalog/api';
describe('Catalog contract adapter', () => {
  it('encodes filters, unwraps data, passes cancellation without owning auth', async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { items: [], total: 0 },
          meta: { correlationId: 'c' },
        }),
      ),
    );
    const controller = new AbortController();
    const api = createCatalogApi(transport);
    expect(await api.doctors('dept &1', 2, controller.signal)).toEqual({
      items: [],
      total: 0,
    });
    expect(transport.mock.calls[0][0]).toBe(
      '/api/v1/doctors?departmentId=dept+%261&page=2&limit=20',
    );
    expect(transport.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it('retains machine error and correlation ID for a 409', async () => {
    const api = createCatalogApi(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'OVERLAPPING_PRICE_PERIOD', message: 'Conflict' },
            meta: { correlationId: 'c1' },
          }),
          { status: 409 },
        ),
    );
    await expect(
      api.createPrice(
        { itemType: 'EXAM', itemId: 'x', amountVnd: 0, effectiveFrom: 'x' },
        'same-key',
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: 'OVERLAPPING_PRICE_PERIOD',
      correlationId: 'c1',
    } satisfies Partial<ApiError>);
  });
});

it('obtains a fresh CA-004 lease per retry while preserving the price intent and key', async () => {
  const transport = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            priceVersionId: 'price',
            revision: 2,
            effectiveFrom: '2030-01-01T00:00:00Z',
          },
        }),
      ),
  );
  const lease = vi
    .fn()
    .mockResolvedValueOnce('lease-one')
    .mockResolvedValueOnce('lease-two');
  const api = createCatalogApi(transport, { authorizationLease: lease });
  const input = {
    itemType: 'EXAM' as const,
    itemId: 'item',
    amountVnd: 25000,
    effectiveFrom: '2030-01-01T00:00:00Z',
  };
  await api.createPrice(input, 'same-intent');
  await api.createPrice(input, 'same-intent');
  expect(lease.mock.calls).toEqual([['CA-004'], ['CA-004']]);
  const first = transport.mock.calls[0][1] as RequestInit;
  const second = transport.mock.calls[1][1] as RequestInit;
  expect(new Headers(first.headers).get('X-Authorization-Lease')).toBe(
    'lease-one',
  );
  expect(new Headers(second.headers).get('X-Authorization-Lease')).toBe(
    'lease-two',
  );
  expect(new Headers(second.headers).get('Idempotency-Key')).toBe(
    'same-intent',
  );
  expect(second.body).toBe(first.body);
});
