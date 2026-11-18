export type PatientProfile = {
  id: string;
  version?: number;
  fullName: string;
  birthDate: string;
  relation: 'SELF' | 'OTHER';
  sex?: string;
  contactPhone?: string;
  address?: string;
  bhytSelfDeclared?: string;
  ownerUserId?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type PatientPage = { items: PatientProfile[]; total: number };

export interface CreatePatientInput {
  relation: 'SELF' | 'OTHER';
  fullName: string;
  birthDate: string;
  sex?: string;
  contactPhone?: string;
  address?: string;
  bhytSelfDeclared?: string;
  ownerPhone?: string;
}

export interface UpdatePatientInput {
  fullName?: string;
  birthDate?: string;
  sex?: string;
  bhytSelfDeclared?: string;
  contactPhone?: string;
  address?: string;
  expectedVersion: number;
}

export interface PatientApiOptions {
  authorizationLease?: (action: string) => Promise<string>;
}

export interface PatientApi {
  search?(query: string, signal?: AbortSignal): Promise<PatientPage>;
  list(page: number, limit: number, signal?: AbortSignal): Promise<PatientPage>;
  getById(patientId: string, signal?: AbortSignal): Promise<PatientProfile>;
  create?(
    input: CreatePatientInput,
    signal?: AbortSignal,
  ): Promise<PatientProfile>;
  update?(
    patientId: string,
    input: UpdatePatientInput,
    signal?: AbortSignal,
  ): Promise<PatientProfile>;
}
