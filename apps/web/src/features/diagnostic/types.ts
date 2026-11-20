export type DiagnosticSession = {
  userId: string;
  actorType: 'STAFF' | 'DOCTOR' | 'PATIENT';
  capabilities: string[];
};
export type DiagnosticOrder = {
  id: string;
  visitId: string;
  patientId: string;
  doctorId: string;
  state: string;
  version: number;
  chargeId?: string;
  chargeState: string;
  refundStatus?: string;
  tests: TestSnapshot[];
  amountVnd?: number;
  createdAt?: string;
};
export type TestSnapshot = {
  testId: string;
  code: string;
  name: string;
  revision: number;
  unit?: string;
  referenceRange?: string;
};
export type ResultItemInput = {
  testCode: string;
  valueText: string;
  flag?: string;
};
export type ResultItem = ResultItemInput & {
  id: string;
  unit?: string;
  referenceRange?: string;
};
export type LabResult = {
  id: string;
  orderId: string;
  specimenId: string;
  revision: number;
  state: 'DRAFT' | 'REVIEW' | 'REWORK' | 'PUBLISHED';
  enteredBy: string;
  version: number;
  items: ResultItem[];
  submittedAt?: string;
  publishedAt?: string;
};
export type Specimen = {
  id: string;
  orderId: string;
  state: string;
  sequence: number;
  barcode: string;
  version: number;
  collectedBy: string;
  collectedAt: string;
  reasonCode?: string;
};
export type OrderDetail = {
  order: DiagnosticOrder;
  specimens: Specimen[];
  results?: LabResult[];
  cancellationId?: string;
};
export type DiagnosticApi = {
  createResult?: (
    id: string,
    input: { items: ResultItemInput[] },
    key: string,
  ) => Promise<{ result: LabResult }>;
  updateResult?: (
    id: string,
    input: { items: ResultItemInput[]; expectedVersion: number },
    key: string,
  ) => Promise<{ result: LabResult }>;
  transitionResult?: (
    id: string,
    action: 'submit-review' | 'return-rework' | 'publish',
    input: { expectedVersion: number; reason?: string },
    key: string,
  ) => Promise<{ result: LabResult }>;
  cancel?: (
    id: string,
    input: { reasonCode: string; expectedVersion: number },
    key: string,
  ) => Promise<{
    order: DiagnosticOrder;
    cancellationId: string;
    refundStatus: string;
  }>;
  publishedResults?: (
    patientId: string,
    page: number,
    limit: number,
    signal?: AbortSignal,
  ) => Promise<{ items: LabResult[]; total: number }>;
  list: (
    query: { state?: string; page: number; limit: number },
    signal?: AbortSignal,
  ) => Promise<{ items: DiagnosticOrder[]; total: number }>;
  detail: (id: string, signal?: AbortSignal) => Promise<OrderDetail>;
  collect: (
    id: string,
    input: { barcode?: string },
    key: string,
  ) => Promise<{ specimen: Specimen }>;
  reject: (
    id: string,
    input: { reasonCode: string; expectedVersion: number },
    key: string,
  ) => Promise<{ specimen: Specimen }>;
  recollect: (
    id: string,
    input: { barcode?: string },
    key: string,
  ) => Promise<{ specimen: Specimen }>;
};
