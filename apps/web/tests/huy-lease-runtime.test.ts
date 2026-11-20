import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  vi.resetModules();
});
it('keeps a valid login when the short-lived signing lease expires and preserves the response body', async () => {
  const { withAuthRedirect } = await import('../src/app/runtime');
  const logout = vi.fn();
  const response = new Response(
    JSON.stringify({ error: { code: 'AUTHZ_LEASE_EXPIRED' } }),
    { status: 401 },
  );
  const transport = withAuthRedirect(
    vi.fn().mockResolvedValue(response),
    logout,
  );
  const returned = await transport('/api/v1/visits/v/complete');
  expect(logout).not.toHaveBeenCalled();
  expect((await returned.json()).error.code).toBe('AUTHZ_LEASE_EXPIRED');
});
it('still redirects on an unauthenticated response', async () => {
  const { withAuthRedirect } = await import('../src/app/runtime');
  const logout = vi.fn();
  await withAuthRedirect(
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), {
        status: 401,
      }),
    ),
    logout,
  )('/api/v1/clinical/worklist');
  expect(logout).toHaveBeenCalledTimes(1);
});
it('does not refresh JWT or replay an expired lease with the same stale header', async () => {
  vi.resetModules();
  sessionStorage.setItem('umc_access_token', 'test-access');
  sessionStorage.setItem('umc_refresh_token', 'test-refresh');
  sessionStorage.setItem(
    'umc_session',
    JSON.stringify({
      userId: 'test-doctor',
      actorType: 'DOCTOR',
      capabilities: [],
    }),
  );
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: { code: 'AUTHZ_LEASE_EXPIRED' } }), {
      status: 401,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const { defaultTransport } = await import('../src/app/runtime');
  const result = await defaultTransport('/api/v1/visits/v/complete', {
    method: 'POST',
    headers: {
      'Idempotency-Key': 'same-intent',
      'X-Authorization-Lease': 'expired-lease',
    },
    body: '{"expectedVersion":2}',
  });
  expect(result.status).toBe(401);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem('umc_access_token')).toBe('test-access');
});
