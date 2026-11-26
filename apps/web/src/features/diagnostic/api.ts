import type { DiagnosticApi } from './types';
export type DiagnosticTransport = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;
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
  if (error instanceof DiagnosticError) {
    const messages: Record<string, string> = {
      UNAUTHENTICATED: 'Vui lòng đăng nhập lại để tiếp tục.',
      FORBIDDEN:
        'Bạn không có quyền thực hiện thao tác này. Người đã tham gia nhập kết quả không được duyệt kết quả đó.',
      STATE_CONFLICT:
        'Trạng thái hoặc phiên bản đã thay đổi. Tải lại dữ liệu trước khi thao tác tiếp.',
      AUTHZ_LEASE_EXPIRED:
        'Phiên quyền đã hết hạn. Thử lại cùng yêu cầu để lấy quyền mới.',
      SERVICE_UNAVAILABLE:
        'Dữ liệu hoặc dịch vụ liên quan chưa sẵn sàng. Vui lòng thử lại.',
      VALIDATION_ERROR:
        'Thông tin chưa hợp lệ. Kiểm tra các trường nhập và danh sách chỉ số xét nghiệm.',
      NOT_FOUND: 'Không tìm thấy dữ liệu được phép xem.',
    };
    return `${messages[error.code] ?? error.message}${error.correlationId ? ` (Mã tra cứu: ${error.correlationId})` : ''}`;
  }
  return 'Không kết nối được máy chủ. Giữ nguyên yêu cầu để thử lại.';
}
export function createDiagnosticApi(
  transport: DiagnosticTransport,
  options: { authorizationLease?: (action: string) => Promise<string> } = {},
): DiagnosticApi {
  async function request<T>(
    path: string,
    init?: RequestInit,
    status = 200,
  ): Promise<T> {
    const res = await transport(`/api/v1/${path}`, init);
    const b = await res.json().catch(() => null);
    if (!res.ok)
      throw new DiagnosticError(
        res.status,
        b?.error?.code ??
          (res.status === 401
            ? 'UNAUTHENTICATED'
            : res.status === 403
              ? 'FORBIDDEN'
              : res.status >= 500
                ? 'SERVICE_UNAVAILABLE'
                : 'INVALID_RESPONSE'),
        b?.error?.message ?? 'Không đọc được phản hồi',
        b?.meta?.correlationId ??
          b?.correlationId ??
          res.headers?.get('X-Correlation-ID') ??
          undefined,
      );
    if (res.status !== status || !b || !Object.hasOwn(b, 'data'))
      throw new DiagnosticError(
        502,
        'INVALID_RESPONSE',
        'Phản hồi máy chủ không đúng hợp đồng',
      );
    return b.data as T;
  }
  const post = (body: unknown, key: string): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
  async function protectedWrite(
    action: string,
    body: unknown,
    key: string,
    method = 'POST',
  ) {
    const init = { ...post(body, key), method };
    if (options.authorizationLease) {
      const headers = new Headers(init.headers);
      headers.set(
        'X-Authorization-Lease',
        await options.authorizationLease(action),
      );
      init.headers = headers;
    }
    return init;
  }
  return {
    createResult: (id, input, key) =>
      request(
        `diagnostic-orders/${encodeURIComponent(id)}/results`,
        post(input, key),
        201,
      ),
    updateResult: async (id, input, key) =>
      request(
        `results/${encodeURIComponent(id)}`,
        await protectedWrite('DI-008', input, key, 'PUT'),
      ),
    transitionResult: async (id, action, input, key) =>
      request(
        `results/${encodeURIComponent(id)}/${action}`,
        action === 'return-rework'
          ? post(input, key)
          : await protectedWrite(
              action === 'submit-review' ? 'DI-009' : 'DI-011',
              input,
              key,
            ),
      ),
    cancel: async (id, input, key) =>
      request(
        `diagnostic-orders/${encodeURIComponent(id)}/cancel`,
        await protectedWrite('DI-012', input, key),
      ),
    publishedResults: async (id, page, limit, signal) => {
      const headers = new Headers();
      if (options.authorizationLease)
        headers.set(
          'X-Authorization-Lease',
          await options.authorizationLease('DI-013'),
        );
      return request(
        `patients/${encodeURIComponent(id)}/published-results?page=${page}&limit=${limit}`,
        { headers, signal, cache: 'no-store' },
      );
    },
    list: (q, signal) => {
      const params = new URLSearchParams({
        page: String(q.page),
        limit: String(q.limit),
      });
      if (q.state) params.set('state', q.state);
      return request(`diagnostic-orders?${params}`, { signal });
    },
    detail: (id, signal) =>
      request(`diagnostic-orders/${encodeURIComponent(id)}`, { signal }),
    collect: (id, input, key) =>
      request(
        `diagnostic-orders/${encodeURIComponent(id)}/specimens`,
        post(input, key),
        201,
      ),
    reject: (id, input, key) =>
      request(`specimens/${encodeURIComponent(id)}/reject`, post(input, key)),
    recollect: (id, input, key) =>
      request(
        `diagnostic-orders/${encodeURIComponent(id)}/recollect`,
        post(input, key),
        201,
      ),
  };
}
