export type PatientProfile = {
  id: string;
  fullName: string;
  birthDate: string;
  relation: "SELF" | "OTHER";
  sex?: string;
  contactPhone?: string;
  address?: string;
  bhytSelfDeclared?: string;
};

export type PatientPage = { items: PatientProfile[]; total: number };
export interface PatientApi {
  list(page: number, limit: number, signal?: AbortSignal): Promise<PatientPage>;
  getById(patientId: string, signal?: AbortSignal): Promise<PatientProfile>;
}