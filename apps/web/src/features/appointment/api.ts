import type { GatewayTransport } from '../../app/runtime';
import type { AdminSummary, AppointmentApi, AppointmentHold, AppointmentSummary, AvailableSlot, QueueTicket, ScheduleInput, ScheduleResult } from './types';

export function createAppointmentApi(transport: GatewayTransport): AppointmentApi {
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
      const error = new Error('Máy chủ trả dữ liệu không đúng hợp đồng.') as Error & {
        status: number;
        code: string;
      };
      error.status = 502;
      error.code = 'INVALID_RESPONSE';
      throw error;
    }
    return body.data as T;
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
        const error = new Error(body?.error?.message ?? 'Không tải được lịch trống.') as Error & {
          status: number;
          code?: string;
          correlationId?: string;
        };
        error.status = response.status;
        error.code = body?.error?.code;
        error.correlationId = body?.correlationId ?? body?.meta?.correlationId;
        throw error;
      }
      if (!body || !Object.hasOwn(body, 'data') || !Array.isArray(body.data?.items)) {
        const error = new Error('Máy chủ trả danh sách lịch không đúng hợp đồng.') as Error & {
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
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(input),
      });
    },
    async releaseHold(holdId, idempotencyKey, signal) {
      return request<{ holdId: string; state: string }>(
        `/api/v1/appointment-holds/${encodeURIComponent(holdId)}`,
        { method: 'DELETE', signal, headers: { 'Idempotency-Key': idempotencyKey } },
      );
    },
    async createAppointment(input, idempotencyKey, signal) {
      return request<AppointmentSummary>('/api/v1/appointments', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(input),
      });
    },
    async getAppointment(appointmentId, signal) {
      return request<AppointmentSummary>(
        `/api/v1/appointments/${encodeURIComponent(appointmentId)}`,
        { signal },
      );
    },
    async listAppointments(patientId, signal) {
      return request<{ items: AppointmentSummary[]; total: number }>(
        `/api/v1/patients/${encodeURIComponent(patientId)}/appointments`,
        { signal },
      );
    },
    async reschedule(appointmentId, input, idempotencyKey, signal) {
      return request<AppointmentSummary>(`/api/v1/appointments/${encodeURIComponent(appointmentId)}/reschedule`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input),
      });
    },
    async cancel(appointmentId, input, idempotencyKey, signal) {
      return request<AppointmentSummary>(`/api/v1/appointments/${encodeURIComponent(appointmentId)}/cancel`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input),
      });
    },
    listQueue(input, signal) {
      const query = new URLSearchParams({ ticketType: input.ticketType, ...(input.date ? { date: input.date } : {}), ...(input.doctorId ? { doctorId: input.doctorId } : {}) });
      return request<{ items: QueueTicket[]; total: number }>(`/api/v1/queues/today?${query}`, { signal });
    },
    checkIn(appointmentId, expectedVersion, idempotencyKey, signal) {
      return request<QueueTicket>(`/api/v1/appointments/${encodeURIComponent(appointmentId)}/check-in`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ expectedVersion }) });
    },
    callNext(input, idempotencyKey, signal) {
      return request<QueueTicket>('/api/v1/queues/call-next', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) });
    },
    noShow(ticketId, input, idempotencyKey, signal) {
      return request<QueueTicket>(`/api/v1/queues/${encodeURIComponent(ticketId)}/no-show`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) });
    },
    createSchedule(input: ScheduleInput, signal) {
      return request<ScheduleResult>('/api/v1/schedules', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    },
    updateSchedule(scheduleId, input, signal) {
      return request<ScheduleResult['schedule']>(`/api/v1/schedules/${encodeURIComponent(scheduleId)}`, { method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    },
    getAdminSummary(date, signal) {
      return request<AdminSummary>(`/api/v1/admin/summary?${new URLSearchParams({ date })}`, { signal });
    },
    listSchedules(input = {}, signal) {
      const query = new URLSearchParams(input);
      return request<{ items: Array<ScheduleResult['schedule']>; total: number }>(`/api/v1/schedules${query.toString() ? `?${query}` : ''}`, { signal });
    },
  };
}
