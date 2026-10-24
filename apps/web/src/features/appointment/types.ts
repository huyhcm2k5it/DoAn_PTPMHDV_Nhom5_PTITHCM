export type AvailableSlot = {
  slotId: string;
  scheduleId: string;
  doctorId: string;
  serviceId: string;
  startAt: string;
  endAt: string;
  remainingCapacity: number;
};
export interface AppointmentApi {
  listAvailable(input: { doctorId: string; serviceId: string; date: string }, signal?: AbortSignal): Promise<AvailableSlot[]>;
}