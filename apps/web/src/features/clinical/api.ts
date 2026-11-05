import type { ClinicalApi, StartResult } from './types';
export type Transport = (url: string, init?: RequestInit) => Promise<Response>;
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public correlationId?: string,
  ) {
    super(message);
  }
}
export type ClinicalApiOptions = {
  authorizationLease?: (action: 'CL-009' | 'CL-010', resourceId: string) => Promise<string>;
};
export function createClinicalApi(
  transport: Transport,
  options: ClinicalApiOptions = {},
): ClinicalApi {
  async function signing(
    method: string,
    input: unknown,
    key: string,
    action: 'CL-009' | 'CL-010',
    id: string,
  ) {
    const init = write(method, input, key);
    if (options.authorizationLease) {
      const headers = new Headers(init.headers);
      headers.set('X-Authorization-Lease', await options.authorizationLease(action, id));
      init.headers = headers;
    }
    return init;
  }
  async function request<T>(path: string, init?: RequestInit, expected = 200): Promise<T> {
    const response = await transport(`/api/v1/${path}`, init);
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        response.status,
        body?.error?.code ?? 'INVALID_RESPONSE',
        body?.error?.message ?? 'Không đọc được phản hồi máy chủ',
        body?.meta?.correlationId,
      );
    if (response.status !== expected || !body || !Object.hasOwn(body, 'data'))
      throw new ApiError(502, 'INVALID_RESPONSE', 'Phản hồi máy chủ không đúng hợp đồng');
    return body.data as T;
  }
  return {
    treatment: {
      medicines: (signal) => request('catalog/medicines?status=ACTIVE', { signal }),
      labTests: (signal) => request('catalog/lab-tests?status=ACTIVE', { signal }),
      createPrescription: (id, input, key) =>
        request(`visits/${encodeURIComponent(id)}/prescriptions`, write('POST', input, key), 201),
      updatePrescription: (id, input, key) =>
        request(`prescriptions/${encodeURIComponent(id)}`, write('PUT', input, key)),
      deletePrescription: (id, version, key) =>
        request(
          `prescriptions/${encodeURIComponent(id)}?expectedVersion=${version}`,
          write('DELETE', undefined, key),
        ),
      finalizePrescription: async (id, input, key) =>
        request(
          `prescriptions/${encodeURIComponent(id)}/finalize`,
          await signing('POST', input, key, 'CL-009', id),
        ),
      complete: async (id, input, key) =>
        request(
          `visits/${encodeURIComponent(id)}/complete`,
          await signing('POST', input, key, 'CL-010', id),
        ),
      requestLab: (id, input, key) =>
        request(`visits/${encodeURIComponent(id)}/lab-orders`, write('POST', input, key), 202),
    },
    worklist: (query, signal) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query))
        if (value !== undefined && value !== '') params.set(key, String(value));
      return request(`clinical/worklist?${params}`, { signal });
    },
    start: async (input, key) => {
      const result = await request<StartResult>(
        'visits/start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify(input),
        },
        202,
      );
      if (result.state !== 'PENDING' || !result.operationId || !result.requestId)
        throw new ApiError(502, 'INVALID_RESPONSE', 'Yêu cầu nhận lượt chưa có mã theo dõi hợp lệ');
      return result;
    },
    detail: (id, signal) => request(`visits/${encodeURIComponent(id)}`, { signal }),
    saveDraft: (id, input, key) =>
      request(`visits/${encodeURIComponent(id)}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
  };
}
function write(method: string, input: unknown, key: string): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  };
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      UNAUTHENTICATED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
      AUTHZ_LEASE_EXPIRED: 'Quyền ký đã hết hạn. Làm mới phiên quyền rồi thử lại cùng yêu cầu.',
      FORBIDDEN: 'Tài khoản hiện tại không có quyền thực hiện thao tác.',
      VISIT_VERSION_CONFLICT:
        'Lượt khám đã thay đổi. Giữ lại nội dung đang nhập và tải bản mới trước khi lưu.',
      VISIT_ALREADY_SIGNED: 'Lượt khám đã ký, không thể sửa nháp.',
      IDEMPOTENCY_CONFLICT: 'Mã yêu cầu đã được dùng cho nội dung khác.',
      SERVICE_UNAVAILABLE: 'Dịch vụ tạm thời chưa sẵn sàng. Bạn có thể thử lại yêu cầu.',
      NOT_FOUND: 'Không tìm thấy lượt khám được phép xem.',
    };
    return `${messages[error.code] ?? error.message}${error.correlationId ? ` (Mã tra cứu: ${error.correlationId})` : ''}`;
  }
  return 'Không kết nối được máy chủ. Nội dung của bạn vẫn được giữ để thử lại.';
}
