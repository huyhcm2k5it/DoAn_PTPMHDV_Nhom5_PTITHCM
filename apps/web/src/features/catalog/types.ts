export type Status = 'ACTIVE' | 'INACTIVE';
export type ItemType = 'EXAM' | 'MEDICINE' | 'LAB';
export type Department = {
  id: string;
  code: string;
  name: string;
  status: Status;
};
export type Doctor = {
  id: string;
  departmentId: string;
  displayName: string;
  status: Status;
};
export type PriceInput = {
  itemType: ItemType;
  itemId: string;
  amountVnd: number;
  effectiveFrom: string;
  effectiveTo?: string;
};
export type Price = PriceInput & { priceVersionId: string; revision: number };
export type PriceVersion = Price & {
  itemCode: string;
  itemName: string;
  createdBy: string;
};
export type MedicalService = {
  id: string;
  departmentId: string;
  code: string;
  name: string;
  status: Status;
  price: Price | null;
};
export type Medicine = {
  id: string;
  code: string;
  name: string;
  unit: string;
  strength?: string;
  form?: string;
  status: Status;
  price: Price | null;
};
export type LabTest = {
  id: string;
  code: string;
  name: string;
  specimenType: string;
  unit?: string;
  referenceRange?: string;
  revision: number;
  status: Status;
  price: Price | null;
};
export type PriceResult = {
  priceVersionId: string;
  revision: number;
  effectiveFrom: string;
};
export type Session = {
  actorType: 'PATIENT' | 'DOCTOR' | 'STAFF';
  capabilities: string[];
};
export interface CatalogApi {
  priceHistory?(
    query: {
      itemType?: ItemType;
      itemId?: string;
      page: number;
      limit: number;
    },
    signal?: AbortSignal,
  ): Promise<{ items: PriceVersion[]; total: number }>;
  departments(signal?: AbortSignal): Promise<Department[]>;
  doctors(
    departmentId: string,
    page: number,
    signal?: AbortSignal,
  ): Promise<{ items: Doctor[]; total: number }>;
  services(
    departmentId: string,
    signal?: AbortSignal,
  ): Promise<MedicalService[]>;
  medicines(q: string, signal?: AbortSignal): Promise<Medicine[]>;
  labTests(q: string, signal?: AbortSignal): Promise<LabTest[]>;
  createPrice(input: PriceInput, idempotencyKey: string): Promise<PriceResult>;
}
export const can = (session: Session | undefined, ...capabilities: string[]) =>
  session?.actorType === 'STAFF' &&
  capabilities.some((c) => session.capabilities.includes(c));
