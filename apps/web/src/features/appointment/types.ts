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
  priceSnapshot?: { amountVnd?: number; currency?: string; snapshotHash?: string } | null;
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
  getAppointment(appointmentId: string, signal?: AbortSignal): Promise<AppointmentSummary>;
  listAppointments(
    patientId: string,
    signal?: AbortSignal,
  ): Promise<{ items: AppointmentSummary[]; total: number }>;
}
