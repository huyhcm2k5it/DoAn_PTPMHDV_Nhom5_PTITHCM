export type AvailableSlot = {
  slotId: string;
  scheduleId: string;
  doctorId: string;
  serviceId: string;
  startAt: string;
  endAt: string;
  remainingCapacity: number;
};
export type AppointmentHold = {
  holdId: string;
  expiresAt: string;
  state: string;
  slotId?: string;
  priceSnapshot?: {
    amountVnd?: number;
    currency?: string;
    snapshotHash?: string;
  } | null;
};
export type AppointmentSummary = {
  requestId?: string;
  appointmentId: string;
  state: string;
  statusUrl?: string;
  appointment?: Record<string, unknown>;
  chargeStatus?: string;
  refundStatus?: string | null;
  chargeSync?: string;
};
export type QueueTicket = {
  ticketId: string;
  appointmentId: string;
  patientId?: string;
  ticketType: 'FIRST' | 'RETURN';
  state: string;
  version: number;
};
export type ScheduleInput = {
  doctorId: string;
  serviceId: string;
  doctorUserId?: string;
  departmentId?: string;
  room?: string;
  startAt: string;
  endAt: string;
  capacityPerSlot: number;
  slotMinutes: number;
  status?: 'OPEN' | 'CLOSED';
};
export type ScheduleResult = {
  schedule: ScheduleInput & { id: string; version: number };
  slots: Array<{
    id: string;
    startAt: string;
    endAt: string;
    capacity: number;
  }>;
};
export type AdminSummary = {
  date: string;
  appointments: {
    total: number;
    byState: Record<string, number>;
    metrics?: Record<string, number>;
  };
  queue: { total: number; byState: Record<string, number> };
};
export interface AppointmentApi {
  listAvailable(
    input: { doctorId: string; serviceId: string; date: string },
    signal?: AbortSignal,
  ): Promise<AvailableSlot[]>;
  createHold(
    input: { patientId: string; slotId: string },
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AppointmentHold>;
  releaseHold(
    holdId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<{ holdId: string; state: string }>;
  createAppointment(
    input: { patientId: string; holdId: string },
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AppointmentSummary>;
  getAppointment(
    appointmentId: string,
    signal?: AbortSignal,
  ): Promise<AppointmentSummary>;
  listAppointments(
    patientId: string,
    signal?: AbortSignal,
  ): Promise<{ items: AppointmentSummary[]; total: number }>;
  reschedule?(
    appointmentId: string,
    input: { newSlotId: string; expectedVersion: number },
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AppointmentSummary>;
  cancel?(
    appointmentId: string,
    input: { reasonCode: string; expectedVersion: number },
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AppointmentSummary>;
  listQueue?(
    input: { date?: string; ticketType: 'FIRST' | 'RETURN'; doctorId?: string },
    signal?: AbortSignal,
  ): Promise<{ items: QueueTicket[]; total: number }>;
  checkIn?(
    appointmentId: string,
    expectedVersion: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<QueueTicket>;
  callNext?(
    input: { ticketType: 'FIRST' | 'RETURN'; doctorId?: string },
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<QueueTicket>;
  noShow?(
    ticketId: string,
    input: { reasonCode: string; expectedVersion: number },
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<QueueTicket>;
  createSchedule?(
    input: ScheduleInput,
    signal?: AbortSignal,
  ): Promise<ScheduleResult>;
  updateSchedule?(
    scheduleId: string,
    input: Partial<ScheduleInput> & { expectedVersion: number },
    signal?: AbortSignal,
  ): Promise<ScheduleResult['schedule']>;
  getAdminSummary?(date: string, signal?: AbortSignal): Promise<AdminSummary>;
  listSchedules?(
    input?: { from?: string; to?: string },
    signal?: AbortSignal,
  ): Promise<{ items: Array<ScheduleResult['schedule']>; total: number }>;
}
