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
  tests: unknown[];
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
export type OrderDetail = { order: DiagnosticOrder; specimens: Specimen[] };
export type DiagnosticApi = {
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
