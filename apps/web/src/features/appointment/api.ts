import type { GatewayTransport } from '../../app/runtime';
import type {
  AdminSummary,
  AppointmentApi,
  AppointmentHold,
  AppointmentSummary,
  AvailableSlot,
  QueueTicket,
  ScheduleInput,
  ScheduleResult,
} from './types';

export function createAppointmentApi(
  transport: GatewayTransport,
  lease?: (action: string) => Promise<string>,
): AppointmentApi {
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await transport(url, init);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(
        body?.error?.message ?? 'Không thực hiện được thao tác lịch khám.',
      ) as Error & { status: number; code?: string; correlationId?: string };
      error.status = response.status;
      error.code = body?.error?.code;
      error.correlationId = body?.correlationId ?? body?.meta?.correlationId;
      throw error;
    }
    if (!body || !Object.hasOwn(body, 'data')) {
      const error = new Error(
        'Máy chủ trả dữ liệu không đúng hợp đồng.',
      ) as Error & {
        status: number;
        code: string;
      };
      error.status = 502;
      error.code = 'INVALID_RESPONSE';
      throw error;
    }
    return body.data as T;
  }
  async function mutationHeaders(action: string, key?: string) {
    const headers = new Headers({
      'Content-Type': 'application/json',
    });
    if (key) headers.set('Idempotency-Key', key);
    if (lease) headers.set('X-Authorization-Lease', await lease(action));
    return headers;
  }
  return {
    async listAvailable(input, signal) {
      const query = new URLSearchParams(input);
      const response = await transport(`/api/v1/slots/available?${query}`, {
        method: 'GET',
        signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(
          body?.error?.message ?? 'Không tải được lịch trống.',
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
      if (
        !body ||
        !Object.hasOwn(body, 'data') ||
        !Array.isArray(body.data?.items)
      ) {
        const error = new Error(
          'Máy chủ trả danh sách lịch không đúng hợp đồng.',
        ) as Error & {
          status: number;
          code: string;
        };
        error.status = 502;
        error.code = 'INVALID_RESPONSE';
        throw error;
      }
      return body.data.items as AvailableSlot[];
    },
    async createHold(input, idempotencyKey, signal) {
      return request<AppointmentHold>('/api/v1/appointment-holds', {
        method: 'POST',
        signal,
        headers: await mutationHeaders('AP-008', idempotencyKey),
        body: JSON.stringify(input),
      });
    },
    async releaseHold(holdId, idempotencyKey, signal) {
      return request<{ holdId: string; state: string }>(
        `/api/v1/appointment-holds/${encodeURIComponent(holdId)}`,
        {
          method: 'DELETE',
          signal,
          headers: await mutationHeaders('AP-009', idempotencyKey),
        },
      );
    },
    async createAppointment(input, idempotencyKey, signal) {
      return request<AppointmentSummary>('/api/v1/appointments', {
        method: 'POST',
        signal,
        headers: await mutationHeaders('AP-010', idempotencyKey),
        body: JSON.stringify(input),
      });
    },
    async getAppointment(appointmentId, signal) {
      const result = await request<AppointmentSummary>(
        `/api/v1/appointments/${encodeURIComponent(appointmentId)}`,
        { signal },
      );
      return {
        ...result,
        appointmentId: result.appointmentId ?? appointmentId,
        state: String(result.appointment?.state ?? result.state),
      };
    },
    async listAppointments(patientId, signal, query = {}) {
      const params = new URLSearchParams(query);
      const result = await request<{
        items: (AppointmentSummary & { id?: string })[];
        total: number;
      }>(
        `/api/v1/patients/${encodeURIComponent(patientId)}/appointments${params.size ? '?' + params : ''}`,
        {
          signal,
        },
      );
      return {
        ...result,
        items: result.items.map((row) => ({
          ...row,
          appointmentId: row.appointmentId ?? row.id ?? '',
          appointment: row.appointment ?? row,
        })),
      };
    },
    async reschedule(appointmentId, input, idempotencyKey, signal) {
      return request<AppointmentSummary>(
        `/api/v1/appointments/${encodeURIComponent(appointmentId)}/reschedule`,
        {
          method: 'POST',
          signal,
          headers: await mutationHeaders('AP-013', idempotencyKey),
          body: JSON.stringify(input),
        },
      );
    },
    async cancel(appointmentId, input, idempotencyKey, signal) {
      return request<AppointmentSummary>(
        `/api/v1/appointments/${encodeURIComponent(appointmentId)}/cancel`,
        {
          method: 'POST',
          signal,
          headers: await mutationHeaders('AP-014', idempotencyKey),
          body: JSON.stringify(input),
        },
      );
    },
    listQueue(input, signal) {
      const query = new URLSearchParams({
        ticketType: input.ticketType,
        ...(input.date ? { date: input.date } : {}),
        ...(input.doctorId ? { doctorId: input.doctorId } : {}),
      });
      return request<{ items: QueueTicket[]; total: number }>(
        `/api/v1/queues/today?${query}`,
        { signal },
      );
    },
    async checkIn(appointmentId, expectedVersion, idempotencyKey, signal) {
      return request<QueueTicket>(
        `/api/v1/appointments/${encodeURIComponent(appointmentId)}/check-in`,
        {
          method: 'POST',
          signal,
          headers: await mutationHeaders('AP-015', idempotencyKey),
          body: JSON.stringify({ expectedVersion }),
        },
      );
    },
    async callNext(input, idempotencyKey, signal) {
      return request<QueueTicket>('/api/v1/queues/call-next', {
        method: 'POST',
        signal,
        headers: await mutationHeaders('AP-017', idempotencyKey),
        body: JSON.stringify(input),
      });
    },
    async noShow(ticketId, input, idempotencyKey, signal) {
      return request<QueueTicket>(
        `/api/v1/queues/${encodeURIComponent(ticketId)}/no-show`,
        {
          method: 'POST',
          signal,
          headers: await mutationHeaders('AP-018', idempotencyKey),
          body: JSON.stringify(input),
        },
      );
    },
    async createSchedule(input: ScheduleInput, idempotencyKey, signal) {
      return request<ScheduleResult>('/api/v1/schedules', {
        method: 'POST',
        signal,
        headers: await mutationHeaders('AP-002', idempotencyKey),
        body: JSON.stringify(input),
      });
    },
    async updateSchedule(scheduleId, input, idempotencyKey, signal) {
      const data = await request<ScheduleResult>(
        `/api/v1/schedules/${encodeURIComponent(scheduleId)}`,
        {
          method: 'PATCH',
          signal,
          headers: await mutationHeaders('AP-003', idempotencyKey),
          body: JSON.stringify(input),
        },
      );
      return data.schedule;
    },
    getAdminSummary(date, signal) {
      return request<AdminSummary>(
        `/api/v1/admin/appointments/summary?${new URLSearchParams({ date, from: date, to: new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10) })}`,
        { signal },
      );
    },
    listSchedules(input = {}, signal) {
      const query = new URLSearchParams(input);
      return request<{
        items: Array<ScheduleResult['schedule']>;
        total: number;
      }>(`/api/v1/schedules${query.toString() ? `?${query}` : ''}`, { signal });
    },
  };
}
