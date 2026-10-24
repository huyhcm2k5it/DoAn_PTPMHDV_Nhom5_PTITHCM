import type { Db } from 'mongodb';
import { entity, installStorage, requiredFields, technicalStorage, type CollectionStorage } from '../../../../mongo/storage.js';

export const patientStorage: readonly CollectionStorage[] = [
  {
    ...entity('patients', [{ name: 'ix_patients_owner', key: { ownerUserId: 1 } }]),
    validator: requiredFields(['id', 'ownerUserId'], {
      id: { bsonType: 'string', minLength: 1 },
      ownerUserId: { bsonType: 'string', minLength: 1 },
    }),
  },
  entity('profile_audit', [{ name: 'ix_profile_audit_patient_at', key: { patientId: 1, at: -1 } }]),
  ...technicalStorage,
];

export async function ensurePatientStorage(db: Db): Promise<void> { await installStorage(db, patientStorage); }
