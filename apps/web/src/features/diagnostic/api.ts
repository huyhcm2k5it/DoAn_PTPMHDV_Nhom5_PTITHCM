import type { DiagnosticApi } from './types';
export type DiagnosticTransport = (url: string, init?: RequestInit) => Promise<Response>;
export class DiagnosticError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public correlationId?: string,
  ) {
    super(message);
  }
}
export function diagnosticMessage(error: unknown): string {
  if (error instanceof DiagnosticError)
    return `${error.message}${error.correlationId ? ` (Mã tra cứu: ${error.correlationId})` : ''}`;
  return 'Không kết nối được máy chủ. Giữ nguyên yêu cầu để thử lại.';
}
export function createDiagnosticApi(transport: DiagnosticTransport): DiagnosticApi {
  async function request<T>(path: string, init?: RequestInit, status = 200): Promise<T> {
    const res = await transport(`/api/v1/${path}`, init);
    const b = await res.json().catch(() => null);
    if (!res.ok)
      throw new DiagnosticError(
        res.status,
        b?.error?.code ?? 'INVALID_RESPONSE',
        b?.error?.message ?? 'Không đọc được phản hồi',
        b?.meta?.correlationId,
      );
    if (res.status !== status || !b || !Object.hasOwn(b, 'data'))
      throw new DiagnosticError(502, 'INVALID_RESPONSE', 'Phản hồi máy chủ không đúng hợp đồng');
    return b.data as T;
  }
  const post = (body: unknown, key: string): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
  return {
    list: (q, signal) => {
      const params = new URLSearchParams({ page: String(q.page), limit: String(q.limit) });
      if (q.state) params.set('state', q.state);
      return request(`diagnostic-orders?${params}`, { signal });
    },
    detail: (id, signal) => request(`diagnostic-orders/${encodeURIComponent(id)}`, { signal }),
    collect: (id, input, key) =>
      request(`diagnostic-orders/${encodeURIComponent(id)}/specimens`, post(input, key), 201),
    reject: (id, input, key) =>
      request(`specimens/${encodeURIComponent(id)}/reject`, post(input, key)),
    recollect: (id, input, key) =>
      request(`diagnostic-orders/${encodeURIComponent(id)}/recollect`, post(input, key), 201),
  };
}
