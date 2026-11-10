export type HoldState =
  | 'NOT_HELD'
  | 'HELD'
  | 'SETTLEMENT_LOCKED'
  | 'COMMITTED'
  | 'DISPENSED'
  | 'RELEASED'
  | 'EXPIRED';
export type StockItem = {
  medicineId: string;
  medicineCode?: string;
  name?: string;
  onHand: number;
  reserved: number;
  available: number;
  version: number;
};
export type Prescription = {
  id: string;
  prescriptionId?: string;
  revision: number;
  patientId: string;
  itemsSnapshot: {
    medicineCode: string;
    nameSnapshot?: string;
    quantity: number;
    doseText?: string;
  }[];
};
export type MedicationHold = {
  id: string;
  prescriptionId: string;
  revision: number;
  attemptNo: number;
  status: HoldState;
  version: number;
  expiresAt: string;
  amountVnd: number;
  chargeId?: string;
  chargeSync: string;
  settlementState: string;
};
export type PrescriptionDetail = {
  prescriptionId: string;
  revision: number;
  latestHoldState: HoldState;
  dispensedAt: string | null;
  view: 'PHARMACY' | 'PATIENT_STATUS';
  prescription?: Prescription;
  stock?: StockItem[];
  holds?: MedicationHold[];
};
export type PendingHold = {
  requestId: string;
  holdId: string;
  state: HoldState;
  statusUrl: string;
};
export type PharmacyApi = {
  stock: (
    query?: { page?: number; limit?: number; code?: string; name?: string },
    signal?: AbortSignal,
  ) => Promise<{ items: StockItem[]; total: number }>;
  receiveStock: (
    input: { medicineId: string; quantity: number; batchRef?: string },
    key: string,
  ) => Promise<{
    stockReceiptId: string;
    medicineId: string;
    onHand: number;
    available: number;
  }>;
  queue: (
    page?: number,
    signal?: AbortSignal,
  ) => Promise<{ items: Prescription[]; total: number }>;
  detail: (
    prescriptionId: string,
    revision?: number,
    signal?: AbortSignal,
  ) => Promise<PrescriptionDetail>;
  hold: (
    prescriptionId: string,
    prescriptionRevision: number,
    key: string,
  ) => Promise<PendingHold>;
  release: (
    holdId: string,
    expectedVersion: number,
    key: string,
  ) => Promise<{ holdId: string; state: HoldState }>;
  reconcile: (
    holdId: string,
    expectedAttemptNo: number,
    key: string,
  ) => Promise<PendingHold>;
  dispense: (
    holdId: string,
    expectedVersion: number,
    key: string,
  ) => Promise<{ dispenseId: string; holdId: string; state: HoldState }>;
};
