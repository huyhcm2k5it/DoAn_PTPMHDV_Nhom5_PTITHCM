import type { GatewayTransport } from '../../app/runtime';
import type {
  CreatePatientInput,
  PatientApi,
  PatientApiOptions,
  PatientPage,
  PatientProfile,
  UpdatePatientInput,
} from './types';

export function createPatientApi(
  transport: GatewayTransport,
  options: PatientApiOptions = {},
): PatientApi {
  async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await transport(path, { method: 'GET', signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(
        body?.error?.message ?? 'Không tải được dữ liệu hồ sơ.',
      ) as Error & {
        status: number;
        code?: string;
        correlationId?: string;
      };
      error.status = response.status;
      error.code = body?.error?.code;
      error.correlationId = body?.correlationId ?? body?.meta?.correlationId;
      throw error;
    }
    if (!body || !Object.hasOwn(body, 'data')) {
      const error = new Error(
        'Máy chủ trả dữ liệu hồ sơ không đúng hợp đồng.',
      ) as Error & { status: number; code: string };
      error.status = 502;
      error.code = 'INVALID_RESPONSE';
      throw error;
    }
    return body.data as T;
  }

  async function mutate<T>(
    path: string,
    method: 'POST' | 'PATCH',
    action: 'PT-003' | 'PT-005',
    input: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    };

    if (options.authorizationLease) {
      try {
        headers['X-Authorization-Lease'] =
          await options.authorizationLease(action);
      } catch {
        // Tiếp tục gửi để server phản hồi mã lỗi chuẩn nếu thiếu lease
      }
    }

    const response = await transport(path, {
      method,
      signal,
      headers,
      body: JSON.stringify(input),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      let message = body?.error?.message ?? 'Không thể cập nhật hồ sơ.';
      const code = body?.error?.code;

      if (code === 'DUPLICATE_PATIENT_PROFILE') {
        message = 'Hồ sơ bệnh nhân đã tồn tại trên hệ thống.';
      } else if (code === 'STATE_CONFLICT') {
        message =
          'Hồ sơ đã được thay đổi bởi một phiên khác. Vui lòng tải lại.';
      } else if (code === 'AUTHZ_LEASE_EXPIRED') {
        message = 'Phiên ủy quyền đã hết hạn. Vui lòng thử lại.';
      } else if (code === 'VALIDATION_ERROR') {
        message = 'Thông tin hồ sơ không hợp lệ. Vui lòng kiểm tra lại.';
      }

      const error = new Error(message) as Error & {
        status: number;
        code?: string;
      };
      error.status = response.status;
      error.code = code;
      throw error;
    }
    return body.data.patient as T;
  }

  return {
    list(page, limit, signal) {
      const query = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      return request<PatientPage>(`/api/v1/patients?${query}`, signal);
    },
    async getById(patientId, signal) {
      const data = await request<{ patient: PatientProfile }>(
        `/api/v1/patients/${encodeURIComponent(patientId)}`,
        signal,
      );
      return data.patient;
    },
    create(input: CreatePatientInput, signal) {
      return mutate<PatientProfile>(
        '/api/v1/patients',
        'POST',
        'PT-003',
        input,
        signal,
      );
    },
    update(patientId: string, input: UpdatePatientInput, signal) {
      return mutate<PatientProfile>(
        `/api/v1/patients/${encodeURIComponent(patientId)}`,
        'PATCH',
        'PT-005',
        input,
        signal,
      );
    },
  };
}
