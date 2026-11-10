import type { GatewayTransport } from '../../app/runtime';
import type { PharmacyApi } from './types';
export function createPharmacyApi(
  transport: GatewayTransport,
  options: {
    authorizationLease?: (action: string) => Promise<string>;
  } = {},
): PharmacyApi {
  const root = '/api/v1/pharmacy';
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const method = init?.method || 'GET';
    const action = path.startsWith('/stock/receipts')
      ? 'PH002'
      : path.startsWith('/prescriptions/queue')
        ? 'PH003'
        : path.startsWith('/prescriptions/')
          ? method === 'POST'
            ? 'PH005'
            : 'PH004'
          : path.includes('/dispense')
            ? 'PH008'
            : path.includes('/commit')
              ? 'PH007'
              : path.startsWith('/holds/')
                ? 'PH006'
                : undefined;
    const headers = new Headers(init?.headers);
    if (action) {
      if (!options.authorizationLease)
        throw Object.assign(
          new Error('Phiên chưa cung cấp quyền thao tác ngắn hạn từ Identity.'),
          {
            status: 503,
            code: 'AUTHORIZATION_LEASE_REQUIRED',
          },
        );
      headers.set(
        'X-Authorization-Lease',
        await options.authorizationLease(action),
      );
    }
    const response = await transport(root + path, {
      ...init,
      headers: Object.fromEntries(headers.entries()),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw Object.assign(
        new Error(
          body?.error?.message || 'Không thực hiện được thao tác dược.',
        ),
        {
          status: response.status,
          code: body?.error?.code,
          correlationId: body?.meta?.correlationId,
        },
      );
    if (!body || !Object.hasOwn(body, 'data'))
      throw Object.assign(new Error('Phản hồi không đúng định dạng.'), {
        status: 502,
      });
    return body.data;
  }
  const post = (input: unknown, key: string): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
  return {
    stock: (query = {}, signal) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query))
        if (value !== undefined && value !== '') params.set(key, String(value));
      return request('/stock?' + params, { signal });
    },
    receiveStock: (input, key) => request('/stock/receipts', post(input, key)),
    queue: (page = 1, signal) =>
      request('/prescriptions/queue?page=' + page + '&limit=20', { signal }),
    detail: (id, revision, signal) =>
      request(
        '/prescriptions/' +
          encodeURIComponent(id) +
          (revision ? '?revision=' + revision : ''),
        { signal },
      ),
    hold: (id, prescriptionRevision, key) =>
      request(
        '/prescriptions/' + encodeURIComponent(id) + '/holds',
        post({ prescriptionRevision }, key),
      ),
    release: (id, expectedVersion, key) =>
      request(
        '/holds/' +
          encodeURIComponent(id) +
          '?expectedVersion=' +
          expectedVersion,
        {
          method: 'DELETE',
          headers: { 'Idempotency-Key': key },
        },
      ),
    reconcile: (id, expectedAttemptNo, key) =>
      request(
        '/holds/' + encodeURIComponent(id) + '/commit',
        post({ expectedAttemptNo }, key),
      ),
    dispense: (id, expectedVersion, key) =>
      request(
        '/holds/' + encodeURIComponent(id) + '/dispense',
        post({ expectedVersion }, key),
      ),
  };
}
