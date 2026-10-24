import type { GatewayTransport } from "../../app/runtime";
import type { AppointmentApi, AvailableSlot } from "./types";

export function createAppointmentApi(transport: GatewayTransport): AppointmentApi {
  return {
    async listAvailable(input, signal) {
      const query = new URLSearchParams(input);
      const response = await transport(`/api/v1/slots/available?${query}`, { method: "GET", signal });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(body?.error?.message ?? "Không tải được lịch trống.") as Error & { status: number; code?: string; correlationId?: string };
        error.status = response.status; error.code = body?.error?.code;
        error.correlationId = body?.correlationId ?? body?.meta?.correlationId;
        throw error;
      }
      if (!body || !Object.hasOwn(body, "data") || !Array.isArray(body.data?.items)) {
        const error = new Error("Máy chủ trả danh sách lịch không đúng hợp đồng.") as Error & { status: number; code: string };
        error.status = 502; error.code = "INVALID_RESPONSE"; throw error;
      }
      return body.data.items as AvailableSlot[];
    },
  };
}