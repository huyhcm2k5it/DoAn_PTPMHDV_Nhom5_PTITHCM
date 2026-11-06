import type { GatewayTransport } from "../../app/runtime";
import type { PatientApi, PatientPage, PatientProfile } from "./types";

export function createPatientApi(transport: GatewayTransport): PatientApi {
  async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await transport(path, { method: "GET", signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error?.message ?? "Không tải được dữ liệu hồ sơ.") as Error & {
        status: number; code?: string; correlationId?: string;
      };
      error.status = response.status;
      error.code = body?.error?.code;
      error.correlationId = body?.correlationId ?? body?.meta?.correlationId;
      throw error;
    }
    if (!body || !Object.hasOwn(body, "data")) {
      const error = new Error("Máy chủ trả dữ liệu hồ sơ không đúng hợp đồng.") as Error & { status: number; code: string };
      error.status = 502; error.code = "INVALID_RESPONSE"; throw error;
    }
    return body.data as T;
  }
  async function mutate<T>(path: string, method: 'POST' | 'PATCH', input: unknown, signal?: AbortSignal): Promise<T> {
    const response = await transport(path, { method, signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error?.message ?? 'Không thể cập nhật hồ sơ.') as Error & { status: number; code?: string };
      error.status = response.status; error.code = body?.error?.code; throw error;
    }
    return body.data.patient as T;
  }
  return {
    list(page, limit, signal) {
      const query = new URLSearchParams({ page: String(page), limit: String(limit) });
      return request<PatientPage>(`/api/v1/patients?${query}`, signal);
    },
    async getById(patientId, signal) {
      const data = await request<{ patient: PatientProfile }>(`/api/v1/patients/${encodeURIComponent(patientId)}`, signal);
      return data.patient;
    },
    create(input, signal) { return mutate<PatientProfile>('/api/v1/patients', 'POST', input, signal); },
    update(patientId, input, signal) { return mutate<PatientProfile>(`/api/v1/patients/${encodeURIComponent(patientId)}`, 'PATCH', input, signal); },
  };
}
