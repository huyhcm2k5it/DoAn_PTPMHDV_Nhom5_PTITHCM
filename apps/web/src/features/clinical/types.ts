export type VisitState =
  | "IN_PROGRESS"
  | "LAB_REQUEST_PENDING"
  | "WAITING_LAB"
  | "RETURN_READY"
  | "WAITING_RETURN"
  | "SIGNED";
export type Visit = {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorUserId: string;
  departmentId: string;
  claimId: string;
  state: VisitState;
  version: number;
  returnRound: number;
  startedAt: string;
  signedAt?: string;
};
export type VisitNote = {
  id: string;
  visitId: string;
  revision: number;
  symptoms: string;
  findings: string;
  assessment: string;
  diagnosis: string;
  authorUserId: string;
  savedAt: string;
};
export type VisitDetail = {
  visit: Visit;
  notes: VisitNote[];
  prescriptions: unknown[];
  labRequests: unknown[];
};
export type StartInput = {
  ticketId: string;
  doctorId: string;
  expectedTicketVersion: number;
};
export type StartResult = {
  requestId: string;
  operationId: string;
  state: "PENDING" | "ACCEPTED" | "REJECTED";
  statusUrl: string;
  visitId?: string;
  reasonCode?: string;
};
export type WorklistQuery = {
  date?: string;
  state?: string;
  page?: number;
  limit?: number;
  operationId?: string;
};
export type Worklist = {
  items: Visit[];
  total: number;
  startRequest: StartResult | null;
};
export type DraftInput = {
  symptoms: string;
  findings: string;
  assessment: string;
  diagnosis: string;
  expectedVersion: number;
};
export type DraftResult = {
  visitId: string;
  version: number;
  state: VisitState;
};
export type ClinicalSession = {
  userId: string;
  actorType: "DOCTOR" | "PATIENT" | "STAFF";
};
export type ClinicalApi = {
  worklist: (query: WorklistQuery, signal?: AbortSignal) => Promise<Worklist>;
  start: (input: StartInput, key: string) => Promise<StartResult>;
  detail: (visitId: string, signal?: AbortSignal) => Promise<VisitDetail>;
  saveDraft: (
    visitId: string,
    input: DraftInput,
    key: string,
  ) => Promise<DraftResult>;
};
