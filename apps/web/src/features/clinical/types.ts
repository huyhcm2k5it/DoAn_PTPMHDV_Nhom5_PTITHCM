export type VisitState =
  | 'IN_PROGRESS'
  | 'LAB_REQUEST_PENDING'
  | 'WAITING_LAB'
  | 'RETURN_READY'
  | 'WAITING_RETURN'
  | 'SIGNED';
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
  prescriptions: Prescription[];
  labRequests: LabRequest[];
};
export type StartInput = {
  ticketId: string;
  doctorId: string;
  expectedTicketVersion: number;
};
export type StartResult = {
  requestId: string;
  operationId: string;
  state: 'PENDING' | 'ACCEPTED' | 'REJECTED';
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
  actorType: 'DOCTOR' | 'PATIENT' | 'STAFF';
};
export type ClinicalApi = {
  treatment?: ClinicalTreatmentApi;
  worklist: (query: WorklistQuery, signal?: AbortSignal) => Promise<Worklist>;
  start: (input: StartInput, key: string) => Promise<StartResult>;
  detail: (visitId: string, signal?: AbortSignal) => Promise<VisitDetail>;
  saveDraft: (
    visitId: string,
    input: DraftInput,
    key: string,
  ) => Promise<DraftResult>;
};
export type PrescriptionLine = {
  medicineCode: string;
  nameSnapshot?: string;
  doseText: string;
  quantity: number;
  instruction?: string;
};
export type Prescription = {
  id: string;
  visitId: string;
  patientId: string;
  state: 'DRAFT' | 'FINAL' | 'DELETED';
  version: number;
  revision: number;
  lines: PrescriptionLine[];
};
export type LabRequest = {
  requestId: string;
  state: string;
  orderId?: string;
  reasonCode?: string;
};
export type TreatmentCatalogMedicine = {
  code: string;
  name: string;
  status: string;
};
export type TreatmentCatalogTest = {
  id: string;
  name: string;
  revision: number;
  status: string;
};
export type ClinicalTreatmentApi = {
  medicines: (signal?: AbortSignal) => Promise<TreatmentCatalogMedicine[]>;
  labTests: (signal?: AbortSignal) => Promise<TreatmentCatalogTest[]>;
  createPrescription: (
    visitId: string,
    input: { lines: PrescriptionLine[] },
    key: string,
  ) => Promise<{ prescription: Prescription }>;
  updatePrescription: (
    id: string,
    input: { lines: PrescriptionLine[]; expectedVersion: number },
    key: string,
  ) => Promise<{ prescription: Prescription }>;
  deletePrescription: (
    id: string,
    version: number,
    key: string,
  ) => Promise<{ prescriptionId: string; state: string }>;
  finalizePrescription: (
    id: string,
    input: { expectedVersion: number },
    key: string,
  ) => Promise<{ prescription: Prescription }>;
  complete: (
    id: string,
    input: { expectedVersion: number },
    key: string,
  ) => Promise<DraftResult>;
  requestLab: (
    id: string,
    input: { tests: { testId: string; revision: number }[] },
    key: string,
  ) => Promise<{ requestId: string; state: string; statusUrl: string }>;
};
